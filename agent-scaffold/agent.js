// Node's built-in readline, used to prompt the user in the console for
// tool-approval (y/n) before any tool call is allowed to run.
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

// Loads variables from .env into process.env as a side effect (no exports used).
import 'dotenv/config';
// Runtime schema validation for the tool's input (replaces manual type checks).
import { z } from 'zod';
// The Claude Agent SDK: lets us define custom tools, host them as an
// in-process MCP server, and drive the agent's query/response loop.
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';

// Fail fast with a clear message instead of letting the SDK error out later
// with a less obvious "unauthorized" failure.
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env before running.');
}

// Mock inventory: known SKUs return a fixed count, unknown SKUs get a
// deterministic pseudo-random count so repeated lookups stay stable.
const MOCK_STOCK_LEVELS = {
  'WB-1L': 42,
};

// Returns a "stock count" for any SKU string, without a real database.
function getMockStockCount(sku) {
  // Known SKU: return its fixed count from the table above.
  const known = MOCK_STOCK_LEVELS[sku];
  if (known !== undefined) {
    return known;
  }

  // Unknown SKU: derive a stable fake count from the SKU text itself, so the
  // same SKU always returns the same number (but different SKUs differ).
  // This is a simple rolling hash (multiply-by-31-and-add, like Java's
  // String.hashCode()), kept in the 0-999 range by the `% 1000`.
  let hash = 0;
  for (let i = 0; i < sku.length; i++) {
    hash = (hash * 31 + sku.charCodeAt(i)) % 1000;
  }
  return hash;
}

// Defines the custom tool the agent can call. `tool()` wires together:
//   1. the tool's name ("get_stock_level"),
//   2. a description shown to the model so it knows when to use it,
//   3. a zod schema describing/validating the expected input shape,
//   4. the async handler that actually runs when the model calls the tool.
const getStockLevel = tool(
  'get_stock_level',
  'Look up the current stock count for a given SKU.',
  { sku: z.string().min(1, 'sku must not be empty') }, // input schema: { sku: string }
  async ({ sku }) => {
    const count = getMockStockCount(sku);
    // MCP tools must return a `content` array of blocks; here we return a
    // single plain-text block, which is what the model sees as the result.
    return {
      content: [{ type: 'text', text: `SKU ${sku}: ${count} in stock` }],
    };
  },
);

// Bundles the tool(s) above into an in-process MCP server named
// "inventory-tools", which gets registered with the agent below via the
// `mcpServers` option. This is what makes get_stock_level callable at all.
const inventoryTools = createSdkMcpServer({
  name: 'inventory-tools',
  version: '1.0.0',
  tools: [getStockLevel],
});

// Console interface used to read the user's y/n answer to permission prompts.
const rl = createInterface({ input: stdin, output: stdout });

// Prompts on stdin for a y/n approval before letting any tool call run.
// This is the actual enforcement mechanism behind permissionMode: 'default'
// below — the SDK calls this function for every tool call and blocks until
// it resolves with an allow/deny decision.
const approveToolUse = async (toolName, input, { title }) => {
  console.log('\n--- permission request ---');
  // `title` is a human-readable description the SDK may provide (e.g.
  // "Claude wants to run tool X"); fall back to building our own if absent.
  console.log(title ?? `Claude wants to run tool "${toolName}"`);
  console.log('input:', JSON.stringify(input));
  const answer = await rl.question('Allow this tool call? (y/n) ');
  console.log('---------------------------\n');

  const allowed = answer.trim().toLowerCase() === 'y';
  // Result must be one of these two exact shapes: 'allow' (with the input
  // to actually pass through) or 'deny' (with a reason message).
  return allowed
    ? { behavior: 'allow', updatedInput: input }
    : { behavior: 'deny', message: 'Denied by user at the console prompt.' };
};

async function main() {
  // Starts the agent run. `query()` returns an async-iterable stream of
  // messages (system/assistant/user/result) as the conversation progresses —
  // nothing runs yet until we start iterating over it below.
  const stream = query({
    prompt: 'How many of SKU WB-1L do we have in stock?',
    options: {
      // Registers our custom MCP server so the model can see and call
      // get_stock_level. Key is the server name used internally.
      mcpServers: {
        'inventory-tools': inventoryTools,
      },
      // 'default' = standard prompting behavior: every tool call is routed
      // through canUseTool for explicit approval, instead of being
      // auto-accepted (acceptEdits/bypassPermissions) or auto-decided
      // (auto/dontAsk).
      permissionMode: 'default',
      // Our y/n console prompt, called by the SDK to resolve each request.
      canUseTool: approveToolUse,
    },
  });

  // Iterate over every message the agent emits during the run and print it,
  // so nothing (including intermediate tool calls/results) is hidden.
  for await (const message of stream) {
    switch (message.type) {
      // Emitted once at the start of the session.
      case 'system':
        if (message.subtype === 'init') {
          console.log('[system] session started', message.session_id);
        }
        break;

      // Emitted for each piece of the model's response. A single assistant
      // turn can contain multiple content blocks: plain text, or a
      // tool_use block (the model asking to call a tool).
      case 'assistant':
        for (const block of message.message.content) {
          if (block.type === 'text') {
            console.log('[assistant]', block.text);
          } else if (block.type === 'tool_use') {
            console.log('[assistant] tool_use ->', block.name, JSON.stringify(block.input));
          }
        }
        break;

      // In the Anthropic Messages API, a tool's result is sent back as a
      // "user" message containing a tool_result block (not a separate
      // message type) — this is where we print what the tool returned.
      case 'user':
        if (Array.isArray(message.message.content)) {
          for (const block of message.message.content) {
            if (block.type === 'tool_result') {
              // tool_result content can itself be a string or an array of
              // blocks; normalize both cases down to a printable string.
              const text = Array.isArray(block.content)
                ? block.content
                    .filter((part) => part.type === 'text')
                    .map((part) => part.text)
                    .join('\n')
                : String(block.content);
              console.log('[tool_result]', text);
            }
          }
        }
        break;

      // Emitted once at the end of the turn with the final outcome.
      case 'result':
        if (message.subtype === 'success') {
          console.log('[result]', message.result);
        } else {
          console.log('[result:error]', message.subtype);
        }
        break;

      // Other message types (e.g. streaming partials) are ignored here.
      default:
        break;
    }
  }
}

main()
  .catch((error) => {
    console.error('Agent run failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    // Always close the readline interface so the process can exit cleanly
    // instead of hanging on an open stdin listener.
    rl.close();
  });
