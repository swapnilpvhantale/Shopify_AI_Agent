import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { createChatSession } from "./src/chatSession.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3500;

// The frontend is also opened directly from VS Code's Live Server (port
// 5500) instead of this server's own static hosting, which makes it a
// cross-origin request. Allow that known local dev origin, plus any
// production origin(s) that embed this console. Browsers also send an
// Origin header on same-origin POSTs (not just cross-origin ones), and the
// cors middleware's callback below rejects anything not on this list
// regardless of same-origin-ness - so the server's own origin has to be
// listed explicitly too, even though the browser itself wouldn't have
// blocked a same-origin request.
const ALLOWED_ORIGINS = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  // Render sets this automatically to the deployed service's own public
  // HTTPS URL - once deployed there, the embedded page's fetches to itself
  // are "same-origin" but still carry this Origin header (see above), so it
  // has to be allowlisted the same way the localhost origins are.
  ...(process.env.RENDER_EXTERNAL_URL ? [process.env.RENDER_EXTERNAL_URL] : []),
  ...(process.env.EXTRA_ALLOWED_ORIGINS
    ? process.env.EXTRA_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
    : []),
];

// One chat session per browser tab (keyed by the client-generated sessionId),
// kept in memory for the life of the process - fine for local/staff use,
// would need a real store (Redis, DB) to survive restarts or run
// multi-instance.
const sessions = new Map();

const app = express();
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
  })
);
// Required for Shopify to embed this app in the admin's iframe - without it,
// admin.shopify.com's own CSP blocks the frame outright before the page (or
// App Bridge inside it) ever gets a chance to run.
app.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors https://*.myshopify.com https://admin.shopify.com;"
  );
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// The operator picks a role (Admin or Staff) once per browser session before
// any chat happens; that role is baked into the session's system prompt and
// used for every write tool's approval check, so a session can't be started
// without one and the model can never supply its own role.
app.post("/api/session/start", (req, res) => {
  const { sessionId, role } = req.body ?? {};

  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return res.status(400).json({ error: "sessionId is required" });
  }
  if (role !== "admin" && role !== "staff") {
    return res.status(400).json({ error: 'role must be "admin" or "staff"' });
  }

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, createChatSession(sessionId, role));
  }
  const session = sessions.get(sessionId);
  res.json({ role: session.role });
});

app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body ?? {};

  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return res.status(400).json({ error: "sessionId is required" });
  }
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(400).json({ error: "Session not started - call /api/session/start first." });
  }

  try {
    const result = await session.runTurn(message.trim());
    res.json(result);
  } catch (err) {
    console.error("Chat turn failed:", err);
    res.status(500).json({ error: "Something went wrong handling that message." });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Shopify admin agent listening on http://localhost:${PORT}`);
});
