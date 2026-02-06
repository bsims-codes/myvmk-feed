// Run with: node test-discord.mjs "webhook_url" "optional custom message"
// Or set DISCORD_WEBHOOKS environment variable

const webhooks = (process.argv[2] || process.env.DISCORD_WEBHOOKS || "").split(",").filter(Boolean);
const customMessage = process.argv[3];

if (!webhooks.length) {
  console.log("Usage: node test-discord.mjs \"webhook1,webhook2\" \"optional message\"");
  console.log("Or set DISCORD_WEBHOOKS environment variable");
  process.exit(1);
}

const content = customMessage || `**MyVMK Feed Test** ✨\nThis is a test notification from your MyVMK Feed tracker!\nIf you see this, your webhook is working.`;

for (const webhook of webhooks) {
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content })
    });
    if (res.ok) {
      console.log(`✓ Sent to webhook: ${webhook.slice(0, 50)}...`);
    } else {
      console.log(`✗ Failed (${res.status}): ${webhook.slice(0, 50)}...`);
    }
  } catch (err) {
    console.log(`✗ Error: ${err.message}`);
  }
}

console.log("\nDone!");
