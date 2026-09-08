import "dotenv/config";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { rl, ask } from "./src/readline.js";
import { shopifyMcpServer, SHOPIFY_MCP_SERVER_NAME, ALLOWED_TOOLS } from "./src/mcpServer.js";

let resolveTurnGate = null;
let turnGate = Promise.resolve();

function armTurnGate() {
  turnGate = new Promise((resolve) => {
    resolveTurnGate = resolve;
  });
}

function completeTurnGate() {
  if (!resolveTurnGate) return;
  const resolve = resolveTurnGate;
  resolveTurnGate = null;
  resolve();
}

let exiting = false;

async function* userInputGenerator() {
  console.log('Shopify agent ready. Type a request, or "exit" to quit.\n');

  while (true) {
    const input = await ask("You: ");
    const trimmed = input.trim();

    if (trimmed.toLowerCase() === "exit") {
      exiting = true;
      rl.close();
      return;
    }
    if (!trimmed) continue;

    // Arm the gate before yielding so the "result" listener below can
    // resolve it no matter how quickly the turn (and any tool call
    // inside it, including create_draft_order's own y/n prompt) finishes.
    armTurnGate();

    yield {
      type: "user",
      message: { role: "user", content: trimmed },
      parent_tool_use_id: null,
    };

    // Don't ask "You: " again until the SDK's own "result" message says
    // this turn is fully done. Otherwise this generator's next
    // rl.question() races the draft-order tool's confirmation prompt on
    // the same shared readline interface, and whichever answer arrives
    // second gets silently swallowed.
    await turnGate;
  }
}

function logAssistantMessage(message) {
  for (const block of message.message.content) {
    if (block.type === "text") {
      console.log(`\nAgent: ${block.text}\n`);
    } else if (block.type === "tool_use") {
      console.log(`  [calling ${block.name}...]`);
    }
  }
}

function handleSessionMessage(message) {
  if (message.type === "assistant") {
    logAssistantMessage(message);
  } else if (message.type === "result") {
    if (message.subtype !== "success") {
      console.error(`\n[turn ended: ${message.subtype}]\n`);
    }
    completeTurnGate();
  }
}

async function main() {
  const session = query({
    prompt: userInputGenerator(),
    options: {
      mcpServers: { [SHOPIFY_MCP_SERVER_NAME]: shopifyMcpServer },
      allowedTools: ALLOWED_TOOLS,
    },
  });

  try {
    for await (const message of session) {
      handleSessionMessage(message);
    }
  } catch (err) {
    // Ending the input generator (user typed "exit") aborts the SDK's
    // subprocess mid-flight, which surfaces here as a rejection. That's
    // expected on a deliberate quit, so don't treat it as fatal.
    if (!exiting) throw err;
  }

  rl.close();
  console.log("Goodbye.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  rl.close();
  process.exit(1);
});
