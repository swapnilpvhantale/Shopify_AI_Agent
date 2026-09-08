import "dotenv/config";
const domain = process.env.SHOPIFY_STORE_DOMAIN;
const clientId = process.env.SHOPIFY_CLIENT_ID;
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
console.log(domain);
// Paste the https://...ngrok-free.app URL from Step 2
const CALLBACK_URL = "https://26d0-2409-4090-20be-3a03-143e-9e29-b2e0-a029.ngrok-free.app/webhooks/orders-create";
const tokenRes = await fetch(`https://${domain}/admin/oauth/access_token`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type:
"client_credentials" }),
});
const { access_token } = await tokenRes.json();
const res = await fetch(`https://${domain}/admin/api/2026-07/graphql.json`, {
method: "POST",
headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": access_token },
body: JSON.stringify({
query: `
mutation registerWebhook($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
webhookSubscription { id }
userErrors { field message }
}
}
`,
variables: {
topic: "ORDERS_CREATE",
sub: { callbackUrl: CALLBACK_URL, format: "JSON" },
},
}),
});
console.log(JSON.stringify(await res.json(), null, 2));