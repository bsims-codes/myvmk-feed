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

// Update the hosted JSON (latest 20)
writeJson("feed.json", { updatedAt: new Date().toISOString(), items: normalized.slice(0, 20) });

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
    const content = `**MyVMK posted:** ${item.title}\n${item.link}`;
    for (const webhook of DISCORD_WEBHOOKS) {
      await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content })
      });
    }
  }
}

console.log(`Fetched ${normalized.length} items. New: ${newItems.length}`);
