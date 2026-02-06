import fs from "fs";
import fetch from "node-fetch";
import { XMLParser } from "fast-xml-parser";

const RSS_URLS = (process.env.RSS_URLS || "").split(",").filter(Boolean);
const DISCORD_WEBHOOKS = (process.env.DISCORD_WEBHOOKS || "").split(",").filter(Boolean);

function readJson(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, "utf8")); }
  catch { return fallback; }
}
function writeJson(path, data) {
  fs.mkdirSync(path.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

async function fetchRSS(urls) {
  for (const url of urls) {
    try {
      console.log(`Trying ${url}...`);
      const res = await fetch(url, {
        headers: { "user-agent": "github-actions-rss-poller" },
        timeout: 10000
      });
      if (res.ok) {
        console.log(`Success: ${url}`);
        return await res.text();
      }
      console.log(`Failed (${res.status}): ${url}`);
    } catch (err) {
      console.log(`Error: ${url} - ${err.message}`);
    }
  }
  throw new Error("All RSS sources failed");
}

const statePath = ".github/state.json";
const state = readJson(statePath, { lastSeenGuid: null });

const xml = await fetchRSS(RSS_URLS);
const parser = new XMLParser({ ignoreAttributes: false });
const parsed = parser.parse(xml);

const items = parsed?.rss?.channel?.item
  ? (Array.isArray(parsed.rss.channel.item) ? parsed.rss.channel.item : [parsed.rss.channel.item])
  : [];

const normalized = items.map(i => ({
  title: i.title ?? "",
  link: i.link ?? "",
  pubDate: i.pubDate ?? "",
  guid: (typeof i.guid === "object" ? i.guid["#text"] : i.guid) ?? i.link ?? i.title ?? ""
}));

// Load existing feed and merge with new items (archive all tweets)
const existingFeed = readJson("feed.json", { items: [] });
const existingGuids = new Set(existingFeed.items.map(i => i.guid));
const newFromRss = normalized.filter(i => !existingGuids.has(i.guid));

// Merge: new items first, then existing, sorted by date (newest first)
const allItems = [...newFromRss, ...existingFeed.items]
  .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

// Update the hosted JSON (all archived tweets)
writeJson("feed.json", { updatedAt: new Date().toISOString(), items: allItems });

// Determine which are new since last run
let newItems = [];
if (state.lastSeenGuid) {
  for (const item of normalized) {
    if (item.guid === state.lastSeenGuid) break;
    newItems.push(item);
  }
} else {
  // First run: do not spam; just set baseline
  newItems = [];
}

if (normalized[0]?.guid) {
  state.lastSeenGuid = normalized[0].guid;
  writeJson(statePath, state);
}

if (DISCORD_WEBHOOKS.length && newItems.length) {
  // Send in chronological order (oldest first)
  newItems.reverse();

  for (const item of newItems.slice(0, 5)) { // cap to avoid flooding
    const payload = {
      username: "MyVMK Feed",
      avatar_url: "https://bsims-codes.github.io/myvmk-feed/gold-logo.ico",
      embeds: [{
        author: {
          name: "New Tweet from @MyVMK",
          icon_url: "https://bsims-codes.github.io/myvmk-feed/image.png",
          url: "https://twitter.com/MyVMK"
        },
        description: item.title,
        color: 0xFFD700, // Gold
        fields: [{
          name: "🔗 View Tweet",
          value: `[Open on Twitter/X](${item.link})`,
          inline: true
        }],
        footer: {
          text: "MyVMK Feed"
        },
        timestamp: item.pubDate || new Date().toISOString()
      }]
    };

    for (const webhook of DISCORD_WEBHOOKS) {
      await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
    }
  }
}

console.log(`Fetched ${normalized.length} items. New: ${newItems.length}`);
