import "dotenv/config";
import express from "express";
import crypto from "crypto";
const app = express();
const WEBHOOK_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
function verifyShopifyWebhook(req, res, next) {
const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
const digest = crypto
.createHmac("sha256", WEBHOOK_SECRET)
.update(req.body)
.digest("base64");
let isValid = false;
try {
isValid =
!!hmacHeader &&
crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
} catch {
// timingSafeEqual throws if the two buffers differ in length
// (e.g. a missing or malformed header) - treat that as "invalid", not a crash
isValid = false;
}
if (!isValid) {
return res.status(401).send("Invalid signature");
}
next();
}
app.post(
"/webhooks/orders-create",
express.raw({ type: "application/json" }),
verifyShopifyWebhook,
(req, res) => {
// Respond fast - Shopify expects a 200 within a few seconds, or it
// will retry and can eventually disable the webhook after repeated failures
res.status(200).send("OK");
const order = JSON.parse(req.body.toString("utf8"));
setImmediate(() => {
console.log(`Order received: #${order.id} - ${order.total_price} ${order.currency}`);
// Any slower downstream work (a DB write, another API call) belongs
// here, after the response has already gone out.
});
}
);
app.listen(3000, () => console.log("Webhook receiver listening on :3000"));
