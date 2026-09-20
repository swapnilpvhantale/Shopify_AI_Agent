// One-off script: registers the orders/create webhook against a given
// publicly-reachable callback URL (an ngrok tunnel during local dev).
// Usage: node scripts/register-webhook.mjs https://<your-tunnel>.ngrok-free.app
import "dotenv/config";
import { adminRequest } from "../src/clients/adminClient.js";

const tunnelUrl = process.argv[2];
if (!tunnelUrl) {
  console.error("Usage: node scripts/register-webhook.mjs https://<your-tunnel>.ngrok-free.app");
  process.exit(1);
}

const callbackUrl = `${tunnelUrl.replace(/\/$/, "")}/webhooks/orders-create`;

const MUTATION = `
  mutation RegisterWebhook($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
      webhookSubscription { id callbackUrl }
      userErrors { field message }
    }
  }
`;

const data = await adminRequest(MUTATION, {
  topic: "ORDERS_CREATE",
  sub: { callbackUrl, format: "JSON" },
});

if (data.webhookSubscriptionCreate.userErrors.length) {
  console.error("FAILED:", JSON.stringify(data.webhookSubscriptionCreate.userErrors, null, 2));
  process.exit(1);
}

console.log("Registered webhook:", JSON.stringify(data.webhookSubscriptionCreate.webhookSubscription, null, 2));
