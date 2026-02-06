// Run with: node test-discord.mjs "webhook_url" "message"
// Or set DISCORD_WEBHOOKS environment variable

const webhooks = (process.argv[2] || process.env.DISCORD_WEBHOOKS || "").split(",").filter(Boolean);
const customMessage = process.argv[3];

if (!webhooks.length) {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   Discord Webhook Sender                      ║
╚══════════════════════════════════════════════════════════════╝

Usage: node test-discord.mjs "webhook_url" "message"

Examples:
  node test-discord.mjs "https://discord.com/api/webhooks/..." "Hello!"

For rich embeds, edit this script or use sendEmbed() function.
`);
  process.exit(1);
}

// Rich embed message sender
async function sendEmbed(webhook, options) {
  const payload = {
    username: options.username || "MyVMK Feed",
    avatar_url: options.avatar || "https://bsims-codes.github.io/myvmk-feed/gold-logo.ico",
    embeds: [{
      title: options.title || null,
      description: options.description || null,
      color: options.color || 0xFFD700, // Gold color
      fields: options.fields || [],
      footer: options.footer ? { text: options.footer } : null,
      timestamp: options.timestamp ? new Date().toISOString() : null
    }]
  };

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return res.ok;
}

// Simple message sender
async function sendMessage(webhook, content) {
  const payload = {
    username: "MyVMK Feed",
    avatar_url: "https://bsims-codes.github.io/myvmk-feed/gold-logo.ico",
    content: content
  };

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return res.ok;
}

// Main execution
for (const webhook of webhooks) {
  try {
    let success;

    if (customMessage) {
      // Send simple message with bot appearance
      success = await sendMessage(webhook, customMessage);
    } else {
      // Send rich embed as default test
      success = await sendEmbed(webhook, {
        title: "✨ MyVMK Feed Bot",
        description: "This is a test notification from your MyVMK Feed tracker!\n\nIf you see this, your webhook is working.",
        color: 0xFFD700,
        footer: "MyVMK Feed • Test Message",
        timestamp: true
      });
    }

    if (success) {
      console.log(`✓ Sent to webhook: ${webhook.slice(0, 50)}...`);
    } else {
      console.log(`✗ Failed: ${webhook.slice(0, 50)}...`);
    }
  } catch (err) {
    console.log(`✗ Error: ${err.message}`);
  }
}

console.log("\nDone!");
