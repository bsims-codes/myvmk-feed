import fs from "fs";
import puppeteer from "puppeteer";

const TWITTER_USERNAME = process.env.TWITTER_USERNAME;
const TWITTER_PASSWORD = process.env.TWITTER_PASSWORD;
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

async function loginToTwitter(page) {
  console.log("Navigating to Twitter login...");
  await page.goto("https://x.com/i/flow/login", { waitUntil: "networkidle2", timeout: 60000 });

  await new Promise(r => setTimeout(r, 3000));

  // Debug: log page content
  const title = await page.title();
  console.log("Page title:", title);

  // Try multiple selectors for username input
  console.log("Looking for username input...");
  const usernameSelectors = [
    'input[autocomplete="username"]',
    'input[name="text"]',
    'input[name="session[username_or_email]"]',
    'input[type="text"]'
  ];

  let usernameInput = null;
  for (const selector of usernameSelectors) {
    usernameInput = await page.$(selector);
    if (usernameInput) {
      console.log(`Found username input with: ${selector}`);
      break;
    }
  }

  if (!usernameInput) {
    console.log("Could not find username input, dumping page HTML...");
    const html = await page.content();
    console.log("Page length:", html.length);
    console.log("First 2000 chars:", html.substring(0, 2000));
    return false;
  }

  // Enter username
  console.log("Entering username...");
  await usernameInput.type(TWITTER_USERNAME, { delay: 100 });
  await new Promise(r => setTimeout(r, 500));
  await page.keyboard.press("Enter");
  await new Promise(r => setTimeout(r, 3000));

  // Check if there's an additional verification step (phone/email)
  const verifyInput = await page.$('input[data-testid="ocfEnterTextTextInput"]');
  if (verifyInput) {
    console.log("Additional verification requested, entering username...");
    await verifyInput.type(TWITTER_USERNAME, { delay: 100 });
    await page.keyboard.press("Enter");
    await new Promise(r => setTimeout(r, 3000));
  }

  // Wait for password screen to load
  console.log("Waiting for password screen...");
  await new Promise(r => setTimeout(r, 2000));

  // Try multiple selectors for password input
  console.log("Looking for password input...");
  const passwordSelectors = [
    'input[name="password"]',
    'input[type="password"]',
    'input[autocomplete="current-password"]'
  ];

  let passwordInput = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    for (const selector of passwordSelectors) {
      passwordInput = await page.$(selector);
      if (passwordInput) {
        console.log(`Found password input with: ${selector}`);
        break;
      }
    }
    if (passwordInput) break;
    console.log(`Attempt ${attempt + 1}: Password input not found, waiting...`);
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!passwordInput) {
    console.log("Could not find password input after retries");
    const html = await page.content();
    console.log("Page length:", html.length);
    console.log("First 2000 chars:", html.substring(0, 2000));
    return false;
  }

  // Enter password
  console.log("Entering password...");
  await passwordInput.type(TWITTER_PASSWORD, { delay: 100 });
  await new Promise(r => setTimeout(r, 500));
  await page.keyboard.press("Enter");

  // Wait for login to complete
  console.log("Waiting for login to complete...");
  await new Promise(r => setTimeout(r, 5000));

  // Check if logged in
  const url = page.url();
  console.log("Current URL:", url);
  if (url.includes("/home") || (!url.includes("/login") && !url.includes("/flow"))) {
    console.log("Login successful!");
    return true;
  }

  console.log("Login may have failed, attempting to continue anyway...");
  return false;
}

async function scrapeTwitter(page, username) {
  const url = `https://twitter.com/${username}`;
  console.log(`\nNavigating to ${url}...`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  // Wait for tweets to load
  console.log("Waiting for tweets to load...");
  await page.waitForSelector('article[data-testid="tweet"]', { timeout: 30000 }).catch(() => {
    console.log("No tweets found with primary selector, checking page...");
  });

  // Give extra time for tweets to render
  await new Promise(r => setTimeout(r, 2000));

  // Extract tweets
  const tweets = await page.evaluate((targetUser) => {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const results = [];

    articles.forEach(article => {
      try {
        // Get tweet text
        const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
        const content = tweetTextEl?.textContent?.trim() || "";

        // Get tweet link (contains the tweet ID)
        const timeEl = article.querySelector("time");
        const linkEl = timeEl?.closest("a");
        const tweetUrl = linkEl?.href || "";
        const tweetId = tweetUrl.split("/status/")[1]?.split("?")[0] || "";

        // Get timestamp
        const datetime = timeEl?.getAttribute("datetime") || new Date().toISOString();

        // Only include tweets from the target user (not retweets from others)
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
      } catch (e) {
        // Skip problematic tweets
      }
    });

    return results;
  }, username);

  console.log(`Found ${tweets.length} tweets`);
  if (tweets.length > 0) {
    console.log("First tweet:", JSON.stringify(tweets[0], null, 2));
  }
  return tweets;
}

// Main execution
console.log("Launching browser...");
const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});

let normalized = [];

try {
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  await page.setViewport({ width: 1280, height: 800 });

  if (TWITTER_USERNAME && TWITTER_PASSWORD) {
    await loginToTwitter(page);
    normalized = await scrapeTwitter(page, TARGET_USER);
  } else {
    console.log("No Twitter credentials provided, skipping...");
  }
} catch (err) {
  console.error("Error:", err.message);
} finally {
  await browser.close();
}

const statePath = ".github/state.json";
const state = readJson(statePath, { lastSeenGuid: null });

// Load existing feed and merge with new items
const existingFeed = readJson("feed.json", { items: [] });
const existingGuids = new Set(existingFeed.items.map(i => i.guid));
const newFromScrape = normalized.filter(i => !existingGuids.has(i.guid));

// Merge: new items first, then existing, sorted by date
const allItems = [...newFromScrape, ...existingFeed.items]
  .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

// Update the hosted JSON
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
  newItems = [];
}

if (normalized[0]?.guid) {
  state.lastSeenGuid = normalized[0].guid;
  writeJson(statePath, state);
}

// Send Discord notifications
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
