import "dotenv/config";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { createChatSession } from "./src/chatSession.js";
import { getSessionIdForCartToken } from "./src/cartRegistry.js";
import { ADMIN_WEBHOOK_SECRET } from "./src/credentials/adminCredentials.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3400;

// The frontend is also opened directly from VS Code's Live Server (port
// 5500) instead of this server's own static hosting, which makes it a
// cross-origin request. Allow just that known local dev origin (plus this
// server's own origin, which never needs CORS in the first place).
const ALLOWED_ORIGINS = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

// One chat session per browser tab (keyed by the client-generated sessionId),
// kept in memory for the life of the process — fine for local testing, would
// need a real store (Redis, DB) to survive restarts or run multi-instance.
const sessions = new Map();

function getOrCreateSession(sessionId) {
  let session = sessions.get(sessionId);
  if (!session) {
    session = createChatSession(sessionId);
    sessions.set(sessionId, session);
  }
  return session;
}

// One open SSE connection per sessionId, so the orders/create webhook can
// push an order-confirmed event straight into the right browser tab's chat
// the instant Shopify reports the order — no polling, no page reload.
const sseClients = new Map();

function pushEventToSession(sessionId, event) {
  const res = sseClients.get(sessionId);
  if (!res) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

const app = express();
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
  })
);

// Registered before express.json() (and with its own express.raw()) because
// HMAC verification needs the exact raw request bytes — once the global JSON
// parser below consumes the body stream, it's gone.
app.post(
  "/webhooks/orders-create",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
    const digest = crypto
      .createHmac("sha256", ADMIN_WEBHOOK_SECRET)
      .update(req.body)
      .digest("base64");

    let validSignature = false;
    try {
      validSignature =
        !!hmacHeader && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
    } catch {
      validSignature = false;
    }

    if (!validSignature) {
      return res.status(401).send("Invalid signature");
    }

    // Respond immediately — Shopify expects 200 within a few seconds and
    // will retry (then eventually disable the webhook) otherwise.
    res.status(200).send("OK");

    setImmediate(() => {
      const order = JSON.parse(req.body.toString("utf8"));
      const sessionId = getSessionIdForCartToken(order.cart_token);
      if (!sessionId) return; // order wasn't placed through one of our carts

      const session = sessions.get(sessionId);
      if (session) session.clearCart();

      pushEventToSession(sessionId, {
        type: "order_confirmed",
        orderName: order.name,
        totalPrice: order.total_price,
        currency: order.currency,
      });
    });
  }
);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/chat/stream/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(":ok\n\n");

  sseClients.set(sessionId, res);
  req.on("close", () => {
    if (sseClients.get(sessionId) === res) sseClients.delete(sessionId);
  });
});

app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body ?? {};

  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return res.status(400).json({ error: "sessionId is required" });
  }
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  try {
    const session = getOrCreateSession(sessionId);
    const result = await session.runTurn(message.trim());
    res.json(result);
  } catch (err) {
    console.error("Chat turn failed:", err);
    res.status(500).json({ error: "Something went wrong handling that message." });
  }
});

app.post("/api/cart/add", async (req, res) => {
  const { sessionId, variantId, quantity } = req.body ?? {};

  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return res.status(400).json({ error: "sessionId is required" });
  }
  if (typeof variantId !== "string" || !variantId.trim()) {
    return res.status(400).json({ error: "variantId is required" });
  }
  const qty = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;

  try {
    const session = getOrCreateSession(sessionId);
    const cart = await session.addToCart(variantId, qty);
    res.json({ cart });
  } catch (err) {
    console.error("Add to cart failed:", err);
    res.status(500).json({ error: "Could not add that item to the cart." });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  const { sessionId, email, password, firstName, lastName } = req.body ?? {};

  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return res.status(400).json({ error: "sessionId is required" });
  }
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  try {
    const session = getOrCreateSession(sessionId);
    const result = await session.signUpCustomer({
      email: email.trim(),
      password,
      firstName: typeof firstName === "string" ? firstName.trim() : "",
      lastName: typeof lastName === "string" ? lastName.trim() : "",
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not create an account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { sessionId, email, password } = req.body ?? {};

  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return res.status(400).json({ error: "sessionId is required" });
  }
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  try {
    const session = getOrCreateSession(sessionId);
    const result = await session.logInCustomer({ email: email.trim(), password });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not log in." });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Shopify chatbot server listening on http://localhost:${PORT}`);
});
