// Scrape tweets from a saved Nitter HTML file or URL
// Usage:
//   node scrape-tweets.mjs                    # scrape from nitter-myvmk.html
//   node scrape-tweets.mjs path/to/file.html  # scrape from specific file
//   node scrape-tweets.mjs https://nitter...  # scrape from URL

import fs from "fs";

const input = process.argv[2] || "nitter-myvmk.html";

function readJson(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, "utf8")); }
  catch { return fallback; }
}

function writeJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function parseTweetsFromHtml(html) {
  const tweets = [];

  // Split by timeline-item and process each
  const parts = html.split(/<div class="timeline-item[^"]*"[^>]*>/);

  for (let i = 1; i < parts.length; i++) {
    // Get content up to the next timeline-item or end
    const block = parts[i].split(/<div class="timeline-item/)[0];

    // Extract tweet link (status ID)
    const linkMatch = block.match(/<a class="tweet-link" href="([^"]+)"/);
    if (!linkMatch) continue;
    const path = linkMatch[1].replace(/#m$/, '');

    // Extract date from tweet-date title attribute
    const dateMatch = block.match(/<span class="tweet-date"><a[^>]*title="([^"]+)"/);
    let pubDate = new Date().toISOString();
    if (dateMatch) {
      try {
        // Parse "Feb 5, 2026 · 11:30 PM UTC" format
        const dateStr = dateMatch[1].replace(' · ', ' ').replace(' UTC', '');
        pubDate = new Date(dateStr + ' UTC').toISOString();
      } catch {}
    }

    // Extract tweet content
    const contentMatch = block.match(/<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!contentMatch) continue;

    // Clean up the content - remove HTML tags but keep text
    let text = contentMatch[1]
      .replace(/<a[^>]*href="\/search\?q=[^"]*"[^>]*>([^<]*)<\/a>/g, '$1')  // Keep hashtag text
      .replace(/<a[^>]*>([^<]*)<\/a>/g, '$1')  // Keep link text
      .replace(/<[^>]+>/g, '')  // Remove remaining tags
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) continue;

    // Build the full Twitter/X link
    const link = `https://twitter.com${path}`;

    tweets.push({
      title: text,
      link: link,
      pubDate: pubDate,
      guid: link
    });
  }

  return tweets;
}

async function main() {
  let html;

  if (input.startsWith('http')) {
    console.log(`Fetching ${input}...`);
    try {
      const res = await fetch(input, {
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
      });
      if (!res.ok) {
        console.log(`✗ Failed to fetch (${res.status})`);
        process.exit(1);
      }
      html = await res.text();
    } catch (err) {
      console.log(`✗ Error: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log(`Reading ${input}...`);
    try {
      html = fs.readFileSync(input, "utf8");
    } catch (err) {
      console.log(`✗ File not found: ${input}`);
      process.exit(1);
    }
  }

  console.log(`Parsing HTML (${html.length} bytes)...`);
  const tweets = parseTweetsFromHtml(html);

  if (tweets.length === 0) {
    console.log("✗ No tweets found. The HTML structure may have changed.");
    process.exit(1);
  }

  console.log(`✓ Found ${tweets.length} tweets\n`);

  // Show preview
  console.log("Preview of first 3 tweets:");
  tweets.slice(0, 3).forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.title.slice(0, 60)}...`);
    console.log(`     ${new Date(t.pubDate).toLocaleDateString()}`);
  });
  console.log("");

  // Load existing feed and merge
  const feed = readJson("feed.json", { items: [] });
  const existingGuids = new Set(feed.items.map(i => i.guid));

  let added = 0;
  for (const tweet of tweets) {
    if (!existingGuids.has(tweet.guid)) {
      feed.items.push(tweet);
      existingGuids.add(tweet.guid);
      added++;
    }
  }

  // Sort by date (newest first)
  feed.items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  feed.updatedAt = new Date().toISOString();

  writeJson("feed.json", feed);

  console.log(`✓ Added ${added} new tweets (${feed.items.length} total in feed.json)`);
  console.log("\nRun 'git add feed.json && git commit -m \"Import tweets\" && git push' to update.");
}

main();
