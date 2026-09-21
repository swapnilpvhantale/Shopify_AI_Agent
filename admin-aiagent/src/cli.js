#!/usr/bin/env node
import "dotenv/config";
import readline from "node:readline";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { opsMcpServer, OPS_MCP_SERVER_NAME, ALLOWED_TOOLS } from "./mcpServer.js";

const SYSTEM_PROMPT = [
  "You are an operations assistant for a Shopify store.",
  "You can check inventory levels (read-only) and update order status (a real write).",
  "Before calling update_order_status, always ask the caller for their role and an explicit yes/no confirmation,",
  "and pass those through as the role and confirmed arguments - never guess or assume them.",
].join(" ");

function queryOptions() {
  return {
    mcpServers: { [OPS_MCP_SERVER_NAME]: opsMcpServer },
    allowedTools: ALLOWED_TOOLS,
    systemPrompt: SYSTEM_PROMPT,
    // Strip every built-in tool (Bash, Read, Write, ...) from Claude's
    // context - allowedTools alone only auto-approves, it doesn't hide
    // tools that aren't listed. This is also what keeps ambient MCP
    // servers registered elsewhere for this project (e.g. via `claude mcp
    // add`) from being reachable here.
    tools: [],
    settingSources: [],
  };
}

// The SDK pulls the next value from the prompt generator as soon as it's
// ready for more input, not after the assistant finishes replying - it's
// built to let you queue several messages ahead of time. A plain REPL loop
// would race: the generator asks for the next line before the previous
// turn's response is even printed. This gate holds the generator at
// `await turnGate` until a "result" message confirms the turn is over, so
// the next "> " prompt only appears once the reply is actually printed.
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

function printMessage(message) {
  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "text") {
        console.log(block.text);
      }
    }
  } else if (message.type === "result") {
    if (message.subtype !== "success") {
      console.error(`[turn ended: ${message.subtype}]`);
    }
    completeTurnGate();
  }
}

async function runOneShot(promptText) {
  for await (const message of query({ prompt: promptText, options: queryOptions() })) {
    printMessage(message);
  }
}

function ask(rl, promptText) {
  return new Promise((resolve) => rl.question(promptText, resolve));
}

// Set right before the deliberate process.exit(0) below, so the abort error
// that the SDK raises while tearing down its child process (in reaction to
// that exit) can be told apart from a real failure and swallowed instead of
// printed as a "Fatal error".
let exitingDeliberately = false;

async function* userMessages(rl) {
  while (true) {
    const line = await ask(rl, "> ");
    const trimmed = line.trim();

    if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
      exitingDeliberately = true;
      rl.close();
      // The underlying CLI subprocess waits on bidirectional traffic rather
      // than plain EOF once an MCP server is registered, so it will not
      // exit on its own when this generator ends. The SDK tracks its child
      // process and tears it down via its own process "exit" handler, so
      // exiting directly here is safe.
      process.exit(0);
    }
    if (!trimmed) continue;

    armTurnGate();
    yield {
      type: "user",
      message: { role: "user", content: trimmed },
      parent_tool_use_id: null,
    };
    await turnGate;
  }
}

async function runRepl() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('Shopify ops agent ready. Type a request, or "exit" to quit.\n');

  try {
    for await (const message of query({ prompt: userMessages(rl), options: queryOptions() })) {
      printMessage(message);
    }
  } catch (error) {
    if (!exitingDeliberately) throw error;
  }
}

async function main() {
  const promptArg = process.argv.slice(2).join(" ").trim();
  if (promptArg) {
    await runOneShot(promptArg);
    return;
  }
  await runRepl();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
