import fs from "fs";
import fetch from "node-fetch";

const NITTER_URL = process.env.NITTER_URL || "https://nitter.net/MyVMK";
const DISCORD_WEBHOOKS = (process.env.DISCORD_WEBHOOKS || "").split(",").filter(Boolean);

function readJson(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, "utf8")); }
  catch { return fallback; }
}
function writeJson(path, data) {
  fs.mkdirSync(path.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

async function scrapeNitter(url) {
  console.log(`Scraping ${url}...`);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  const html = await res.text();

  const tweets = [];

  // Split by timeline-item divs
  const timelineItems = html.split(/<div class="timeline-item[^"]*"[^>]*>/);

  for (const item of timelineItems.slice(1)) { // Skip first empty split
    // Extract tweet link: <a class="tweet-link" href="/MyVMK/status/123#m">
    const linkMatch = item.match(/<a class="tweet-link" href="([^"]+)"/);

    // Extract content: <div class="tweet-content media-body" dir="auto">...</div>
    const contentMatch = item.match(/<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);

    // Extract date: <span class="tweet-date"><a ... title="Feb 5, 2026 · 11:30 PM UTC">
    const dateMatch = item.match(/<span class="tweet-date"[^>]*><a[^>]*title="([^"]+)"/);

    if (linkMatch && contentMatch) {
      // Clean content - remove HTML tags and normalize whitespace
      let content = contentMatch[1]
        .replace(/<a[^>]*>#(\w+)<\/a>/g, '#$1') // Preserve hashtags
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const tweetPath = linkMatch[1].replace(/#.*/, ''); // Remove #m anchor
      const tweetId = tweetPath.split('/').pop() || tweetPath;
      const fullLink = `https://twitter.com${tweetPath}`;

      // Parse date like "Feb 5, 2026 · 11:30 PM UTC"
      let pubDate = new Date().toISOString();
      if (dateMatch) {
        const dateStr = dateMatch[1].replace(' · ', ' ').replace(' UTC', '');
        const parsed = new Date(dateStr + ' UTC');
        if (!isNaN(parsed)) pubDate = parsed.toISOString();
      }

      tweets.push({
        title: content,
        link: fullLink,
        pubDate,
        guid: tweetId
      });
    }
  }

  console.log(`Found ${tweets.length} tweets`);
  return tweets;
}

const statePath = ".github/state.json";
const state = readJson(statePath, { lastSeenGuid: null });

const normalized = await scrapeNitter(NITTER_URL);

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
          icon_url: "https://bsims-codes.github.io/myvmk-feed/gold-logo.ico",
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
