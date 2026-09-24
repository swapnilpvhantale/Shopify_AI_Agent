import { query } from "@anthropic-ai/claude-agent-sdk";
import { createAdminMcpServer, ADMIN_MCP_SERVER_NAME, ALLOWED_TOOLS } from "./mcpServer.js";

function systemPromptFor(role) {
  return [
    "You are an admin operations assistant for a Shopify store, used by store staff (never shoppers).",
    `The operator using this console right now has been authenticated as role: "${role}".`,
    "You can look up products, inventory, orders, and customers freely (read-only, no confirmation needed).",
    "Before calling any write tool (update_inventory, update_order_status, fulfill_order, update_fulfillment_status, update_product), state plainly what you are about to change and ask the operator for an explicit yes/no confirmation in your own words - then pass their answer through as the confirmed argument. Never pass confirmed: true unless the operator just said yes to that specific action in this conversation.",
    "fulfill_order marks an order's items as shipped/fulfilled. update_fulfillment_status is different - it records a shipment tracking milestone (in transit, out for delivery, delivered, etc.) on an already-fulfilled order; use it when asked to mark an order as delivered, in transit, etc.",
    "Never invent product names, order names, variant names, or location names - always look them up first with the read tools.",
    "Keep answers concise and factual, formatted as plain text or short lists - this is an operations tool, not a sales chatbot.",
  ].join(" ");
}

// One ChatSession wraps one persistent Claude Agent SDK `query()` conversation
// per browser/admin session so multi-turn context survives across HTTP
// requests, and each session's write tools are bound to the role the
// operator picked when the session started (see server.js /api/session/start).
export function createChatSession(sessionId, role) {
  const sessionState = { sessionId, role, actionsThisTurn: [] };
  const mcpServer = createAdminMcpServer(sessionState);

  const pending = [];
  let wake = null;

  async function* inputGenerator() {
    while (true) {
      if (pending.length === 0) {
        await new Promise((resolve) => {
          wake = resolve;
        });
        continue;
      }
      yield pending.shift();
    }
  }

  function pushUserMessage(text) {
    pending.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    });
    if (wake) {
      const resolve = wake;
      wake = null;
      resolve();
    }
  }

  const sdkSession = query({
    prompt: inputGenerator(),
    options: {
      systemPrompt: { type: "custom", prompt: systemPromptFor(role) },
      mcpServers: { [ADMIN_MCP_SERVER_NAME]: mcpServer },
      allowedTools: ALLOWED_TOOLS,
      tools: [],
      settingSources: [],
    },
  });
  const messages = sdkSession[Symbol.asyncIterator]();

  let lock = Promise.resolve();

  async function runTurnUnlocked(text) {
    sessionState.actionsThisTurn = [];
    pushUserMessage(text);

    const replyParts = [];
    while (true) {
      const { value: message, done } = await messages.next();
      if (done) break;

      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text.trim()) {
            replyParts.push(block.text.trim());
          }
        }
      } else if (message.type === "result") {
        if (message.subtype !== "success") {
          replyParts.push(`(turn ended: ${message.subtype})`);
        }
        break;
      }
    }

    return {
      reply: replyParts.join("\n\n"),
      actions: sessionState.actionsThisTurn,
    };
  }

  // Serializes turns so two requests for the same session can't interleave
  // into the same SDK stream.
  function runTurn(text) {
    const result = lock.then(() => runTurnUnlocked(text));
    lock = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  return { runTurn, role };
}
