import fs from "fs";
import puppeteer from "puppeteer";

const TWITTER_COOKIES_BASE64 = process.env.TWITTER_COOKIES;
const TARGET_USER = "MyVMK";
const DISCORD_WEBHOOKS = (process.env.DISCORD_WEBHOOKS || "").split(",").filter(Boolean);

function readJson(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, "utf8")); }
  catch { return fallback; }
}
function writeJson(path, data) {
  fs.mkdirSync(path.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

async function scrapeTwitter(cookies, username) {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    await page.setViewport({ width: 1280, height: 800 });

    // Set cookies
    console.log(`Setting ${cookies.length} cookies...`);
    await page.setCookie(...cookies);

    // Navigate to profile
    const url = `https://x.com/${username}`;
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    console.log("Current URL:", page.url());

    // Wait for tweets
    console.log("Waiting for tweets to load...");
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 30000 }).catch(() => {
      console.log("No tweets found with selector");
    });

    await new Promise(r => setTimeout(r, 2000));

    // Extract tweets
    const tweets = await page.evaluate((targetUser) => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const results = [];

      articles.forEach(article => {
        try {
          const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
          const content = tweetTextEl?.textContent?.trim() || "";

          const timeEl = article.querySelector("time");
          const linkEl = timeEl?.closest("a");
          const tweetUrl = linkEl?.href || "";
          const tweetId = tweetUrl.split("/status/")[1]?.split("?")[0] || "";
          const datetime = timeEl?.getAttribute("datetime") || new Date().toISOString();

          const authorEl = article.querySelector('[data-testid="User-Name"]');
          const authorText = authorEl?.textContent || "";
          const isFromTarget = authorText.toLowerCase().includes(targetUser.toLowerCase());

          if (content && tweetId && isFromTarget) {
            results.push({
              title: content,
              link: `https://twitter.com/${targetUser}/status/${tweetId}`,
              pubDate: datetime,
              guid: tweetId
            });
          }
        } catch (e) {}
      });

      return results;
    }, username);

    console.log(`Found ${tweets.length} tweets`);
    if (tweets.length > 0) {
      console.log("First tweet:", JSON.stringify(tweets[0], null, 2));
    }
    return tweets;
  } finally {
    await browser.close();
  }
}

// Main
let normalized = [];

if (!TWITTER_COOKIES_BASE64) {
  console.log("No TWITTER_COOKIES secret provided!");
} else {
  try {
    const cookiesJson = Buffer.from(TWITTER_COOKIES_BASE64, "base64").toString("utf8");
    const cookies = JSON.parse(cookiesJson);
    console.log(`Loaded ${cookies.length} cookies from secret`);
    normalized = await scrapeTwitter(cookies, TARGET_USER);
  } catch (err) {
    console.error("Error:", err.message);
  }
}

const statePath = ".github/state.json";
const state = readJson(statePath, { lastSeenGuid: null });

const existingFeed = readJson("feed.json", { items: [] });
const existingGuids = new Set(existingFeed.items.map(i => i.guid));
const newFromScrape = normalized.filter(i => !existingGuids.has(i.guid));

const allItems = [...newFromScrape, ...existingFeed.items]
  .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

const lastTweetDate = allItems[0]?.pubDate || null;
writeJson("feed.json", {
  lastChecked: new Date().toISOString(),
  lastTweetDate,
  items: allItems
});

let newItems = [];
if (state.lastSeenGuid) {
  for (const item of normalized) {
    if (item.guid === state.lastSeenGuid) break;
    newItems.push(item);
  }
}

if (normalized[0]?.guid) {
  state.lastSeenGuid = normalized[0].guid;
  writeJson(statePath, state);
}

if (DISCORD_WEBHOOKS.length && newItems.length) {
  newItems.reverse();

  for (const item of newItems.slice(0, 5)) {
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
        color: 0xFFD700,
        fields: [{
          name: "View Tweet",
          value: `[Open on Twitter/X](${item.link})`,
          inline: true
        }],
        footer: { text: "MyVMK Feed" },
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

console.log(`\nFetched ${normalized.length} items. New: ${newItems.length}`);
