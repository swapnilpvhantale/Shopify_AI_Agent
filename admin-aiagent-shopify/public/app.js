const LIVE_SERVER_DEV_PORT = "5500";
const BACKEND_DEV_PORT = 3500;
// Relative URLs resolve correctly whenever this page is served by the same
// Express server that hosts the API (local prod-style run, or deployed
// hosting where the page and API share one origin). The only exception is
// the VS Code Live Server dev workflow (page on :5500), which needs to be
// pointed at the backend explicitly.
const API_BASE =
  window.location.port === LIVE_SERVER_DEV_PORT
    ? `${window.location.protocol}//${window.location.hostname}:${BACKEND_DEV_PORT}`
    : "";

const SESSION_KEY = "shopify-admin-session-id";
const ROLE_KEY = "shopify-admin-role";

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

async function apiRequest(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("The admin agent server isn't responding — is it running?");
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

const sessionId = getSessionId();
const messagesEl = document.getElementById("messages");
const chatEl = document.getElementById("chat");
const composerEl = document.getElementById("composer");
const inputEl = document.getElementById("input");
const roleBadgeEl = document.getElementById("role-badge");
const activityListEl = document.getElementById("activity-list");
const activityEmptyEl = document.getElementById("activity-empty");
const roleModalBackdrop = document.getElementById("role-modal-backdrop");
const roleModalError = document.getElementById("role-modal-error");

function scrollToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addBubble(text, role) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.textContent = text;
  messagesEl.appendChild(bubble);
  scrollToBottom();
  return bubble;
}

function addTypingBubble() {
  const bubble = document.createElement("div");
  bubble.className = "bubble assistant typing";
  bubble.innerHTML = "<span></span><span></span><span></span>";
  messagesEl.appendChild(bubble);
  scrollToBottom();
  return bubble;
}

function renderRoleBadge(role) {
  roleBadgeEl.textContent = `Signed in as ${role}`;
  roleBadgeEl.hidden = false;
}

function addActivityEntries(actions) {
  if (!actions || actions.length === 0) return;
  activityEmptyEl.hidden = true;

  for (const action of actions) {
    const item = document.createElement("li");

    const toolName = document.createElement("span");
    toolName.className = "tool-name";
    toolName.textContent = action.tool;
    item.appendChild(toolName);

    const summary = document.createElement("span");
    summary.textContent = action.summary;
    item.appendChild(summary);

    const timestamp = document.createElement("span");
    timestamp.className = "timestamp";
    timestamp.textContent = new Date().toLocaleTimeString();
    item.appendChild(timestamp);

    activityListEl.prepend(item);
  }
}

async function startSession(role) {
  const data = await apiRequest("/api/session/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, role }),
  });
  localStorage.setItem(ROLE_KEY, data.role);
  renderRoleBadge(data.role);
  roleModalBackdrop.hidden = true;
  addBubble(
    `Hi, I'm the Shopify admin assistant. Ask me to check inventory, look up or update orders, edit products, or find customers.`,
    "assistant"
  );
  inputEl.focus();
}

for (const btn of document.querySelectorAll(".role-choice-btn")) {
  btn.addEventListener("click", async () => {
    roleModalError.hidden = true;
    try {
      await startSession(btn.dataset.role);
    } catch (err) {
      roleModalError.textContent = err.message;
      roleModalError.hidden = false;
    }
  });
}

async function sendMessage(text) {
  addBubble(text, "user");
  inputEl.value = "";
  inputEl.disabled = true;
  composerEl.querySelector("button").disabled = true;

  const thinking = addTypingBubble();

  try {
    const data = await apiRequest("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text }),
    });

    thinking.remove();
    addBubble(data.reply || "(no response)", "assistant");
    addActivityEntries(data.actions);
  } catch (err) {
    thinking.remove();
    addBubble(err.message || "Network error — is the server running?", "error");
  } finally {
    inputEl.disabled = false;
    composerEl.querySelector("button").disabled = false;
    inputEl.focus();
  }
}

composerEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  sendMessage(text);
});

// A stored role only means "resume this browser's earlier session" - the
// server still creates a brand new ChatSession keyed off sessionId the first
// time /api/session/start is called after a restart, so this is a UX
// shortcut, not an auth bypass.
const storedRole = localStorage.getItem(ROLE_KEY);
if (storedRole === "admin" || storedRole === "staff") {
  startSession(storedRole).catch(() => {
    roleModalBackdrop.hidden = false;
  });
} else {
  roleModalBackdrop.hidden = false;
}
