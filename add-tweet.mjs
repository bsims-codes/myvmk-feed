// Manually add tweets to your feed
// Usage: node add-tweet.mjs "Tweet text here" "https://twitter.com/MyVMK/status/123" "2024-01-15"

import fs from "fs";

const text = process.argv[2];
const link = process.argv[3];
const date = process.argv[4];

function readJson(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, "utf8")); }
  catch { return fallback; }
}

function writeJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

if (!text) {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   MyVMK Tweet Importer                       ║
╚══════════════════════════════════════════════════════════════╝

USAGE:
  node add-tweet.mjs "Tweet text" "link" "date"

EXAMPLES:
  node add-tweet.mjs "Happy New Year everyone!" "https://twitter.com/MyVMK/status/123" "2024-01-01"
  node add-tweet.mjs "Server maintenance today" "https://x.com/MyVMK/status/456" "2024-06-15 14:30"

BULK IMPORT:
  Create a file called 'tweets-to-import.json' with this format:
  [
    {"text": "Tweet 1", "link": "https://...", "date": "2024-01-01"},
    {"text": "Tweet 2", "link": "https://...", "date": "2024-01-02"}
  ]
  Then run: node add-tweet.mjs --bulk

CURRENT FEED:
`);
  const feed = readJson("feed.json", { items: [] });
  console.log(`  ${feed.items.length} tweets in feed.json\n`);
  process.exit(0);
}

// Bulk import mode
if (text === "--bulk") {
  const toImport = readJson("tweets-to-import.json", null);
  if (!toImport || !Array.isArray(toImport)) {
    console.log("✗ Create tweets-to-import.json first (see usage above)");
    process.exit(1);
  }

  const feed = readJson("feed.json", { items: [] });
  const existingGuids = new Set(feed.items.map(i => i.guid));
  let added = 0;

  for (const t of toImport) {
    const tweet = {
      title: t.text,
      link: t.link,
      pubDate: new Date(t.date).toISOString(),
      guid: t.link
    };

    if (!existingGuids.has(tweet.guid)) {
      feed.items.push(tweet);
      existingGuids.add(tweet.guid);
      added++;
    }
  }

  feed.items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  feed.updatedAt = new Date().toISOString();
  writeJson("feed.json", feed);

  console.log(`✓ Imported ${added} tweets (${feed.items.length} total)`);
  process.exit(0);
}

// Single tweet mode
if (!link) {
  console.log("✗ Missing link. Usage: node add-tweet.mjs \"text\" \"link\" \"date\"");
  process.exit(1);
}

const pubDate = date ? new Date(date).toISOString() : new Date().toISOString();
const tweet = {
  title: text,
  link: link,
  pubDate: pubDate,
  guid: link
};

const feed = readJson("feed.json", { items: [] });

if (feed.items.some(i => i.guid === tweet.guid)) {
  console.log("✗ Tweet already exists in feed");
  process.exit(1);
}

feed.items.push(tweet);
feed.items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
feed.updatedAt = new Date().toISOString();
writeJson("feed.json", feed);

console.log(`✓ Added tweet (${feed.items.length} total)`);
console.log(`  "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
