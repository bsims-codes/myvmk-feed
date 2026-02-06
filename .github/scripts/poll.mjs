import fs from "fs";
import puppeteer from "puppeteer";

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
  console.log(`Launching browser...`);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for tweets to load
    await page.waitForSelector('.timeline-item', { timeout: 30000 }).catch(async () => {
      console.log('No .timeline-item found, checking page content...');
      const html = await page.content();
      console.log('Page title:', await page.title());
      console.log('Page HTML length:', html.length);
      console.log('First 500 chars:', html.substring(0, 500));
    });

    // Extract tweets from the page
    const tweets = await page.evaluate(() => {
      const items = document.querySelectorAll('.timeline-item');
      const results = [];

      items.forEach(item => {
        const linkEl = item.querySelector('a.tweet-link');
        const contentEl = item.querySelector('.tweet-content');
        const dateEl = item.querySelector('.tweet-date a');

        if (linkEl && contentEl) {
          const tweetPath = linkEl.getAttribute('href')?.replace(/#.*/, '') || '';
          const tweetId = tweetPath.split('/').pop() || tweetPath;
          const fullLink = `https://twitter.com${tweetPath}`;

          // Get text content, preserving hashtags
          let content = contentEl.textContent?.trim() || '';

          // Parse date from title attribute like "Feb 5, 2026 · 11:30 PM UTC"
          let pubDate = new Date().toISOString();
          if (dateEl) {
            const dateTitle = dateEl.getAttribute('title');
            if (dateTitle) {
              const dateStr = dateTitle.replace(' · ', ' ').replace(' UTC', '');
              const parsed = new Date(dateStr + ' UTC');
              if (!isNaN(parsed.getTime())) pubDate = parsed.toISOString();
            }
          }

          results.push({
            title: content,
            link: fullLink,
            pubDate,
            guid: tweetId
          });
        }
      });

      return results;
    });

    console.log(`Found ${tweets.length} tweets`);
    if (tweets.length > 0) {
      console.log('First tweet:', JSON.stringify(tweets[0], null, 2));
    }
    return tweets;
  } finally {
    await browser.close();
  }
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
const lastTweetDate = allItems[0]?.pubDate || null;
writeJson("feed.json", {
  lastChecked: new Date().toISOString(),
  lastTweetDate,
  items: allItems
});

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
