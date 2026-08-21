import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import 'dotenv/config';
import { z } from 'zod';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env before running.');
}

// Single shared readline interface: used both for the REPL's "You:" prompt
// and for the calculate_discount confirmation prompt. Safe to share because
// the two never run concurrently — the REPL only asks for the next line
// after the current turn (including any tool call) has fully finished.
const rl = createInterface({ input: stdin, output: stdout });

// Deterministic string hash so mock data is stable across repeated lookups
// of the same name/ID (multiply-by-31-and-add, like Java's hashCode()).
function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) % 1000;
  }
  return hash;
}

function formatZodError(error) {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

// ---------------------------------------------------------------------------
// Tool 1: get_product_info
// ---------------------------------------------------------------------------

const ProductInfoOutput = z.object({
  name: z.string(),
  price: z.number(),
  inStock: z.boolean(),
});

function mockProductInfo(name) {
  const hash = hashString(name);
  const price = Math.round((9.99 + (hash % 90)) * 100) / 100;
  const inStock = hash % 4 !== 0;
  return { name, price, inStock };
}

const getProductInfo = tool(
  'get_product_info',
  'Look up mock product info (name, price, inStock) for a given product name.',
  { name: z.string().min(1, 'name must not be empty') },
  async ({ name }) => {
    // Validate our own output before it goes back to the model, so a bug in
    // the mock data generator can never silently reach Claude as fact.
    const parsed = ProductInfoOutput.safeParse(mockProductInfo(name));
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `get_product_info produced invalid output: ${formatZodError(parsed.error)}` },
        ],
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(parsed.data) }] };
  },
);

// ---------------------------------------------------------------------------
// Tool 2: get_order_status
// ---------------------------------------------------------------------------

const ORDER_STATUSES = ['processing', 'shipped', 'delivered', 'cancelled'];

const OrderStatusOutput = z.object({
  orderId: z.string(),
  status: z.enum(ORDER_STATUSES),
  eta: z.string(),
});

function mockOrderStatus(orderId) {
  const hash = hashString(orderId);
  const status = ORDER_STATUSES[hash % ORDER_STATUSES.length] ?? 'processing';
  const etaDays = 1 + (hash % 7);
  const eta = new Date(Date.now() + etaDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { orderId, status, eta };
}

const getOrderStatus = tool(
  'get_order_status',
  'Look up the mock status (status, eta) of an order by order ID.',
  { orderId: z.string().min(1, 'orderId must not be empty') },
  async ({ orderId }) => {
    const parsed = OrderStatusOutput.safeParse(mockOrderStatus(orderId));
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `get_order_status produced invalid output: ${formatZodError(parsed.error)}` },
        ],
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(parsed.data) }] };
  },
);

// ---------------------------------------------------------------------------
// Tool 3: calculate_discount (guarded by a terminal confirmation prompt)
// ---------------------------------------------------------------------------

const DiscountOutput = z.object({
  originalPrice: z.number(),
  percent: z.number(),
  discountedPrice: z.number(),
});

const calculateDiscount = tool(
  'calculate_discount',
  'Calculate a discounted price for a given price and percentage. Requires explicit user confirmation before applying.',
  {
    price: z.number().positive('price must be positive'),
    percent: z.number().min(0, 'percent must be >= 0').max(100, 'percent must be <= 100'),
  },
  async ({ price, percent }) => {
    // Guardrail: nothing is computed until the user explicitly confirms at
    // the terminal. Only the exact answer "y" counts as confirmation.
    const answer = (await rl.question(`\nApply a ${percent}% discount to $${price}? (y/n) `)).trim();
    if (answer !== 'y') {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Discount declined: user did not confirm (answered "${answer}").`,
          },
        ],
      };
    }

    const discountedPrice = Math.round(price * (1 - percent / 100) * 100) / 100;
    const parsed = DiscountOutput.safeParse({ originalPrice: price, percent, discountedPrice });
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `calculate_discount produced invalid output: ${formatZodError(parsed.error)}` },
        ],
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(parsed.data) }] };
  },
);

const multiToolServer = createSdkMcpServer({
  name: 'multi-tool-agent',
  version: '1.0.0',
  tools: [getProductInfo, getOrderStatus, calculateDiscount],
});

// Pre-approve exactly our three tools (by their MCP-namespaced names) so the
// REPL runs smoothly without a separate approval prompt on top of the
// calculate_discount confirmation above, while still leaving every other
// tool ungranted by default.
const ALLOWED_TOOLS = [
  'mcp__multi-tool-agent__get_product_info',
  'mcp__multi-tool-agent__get_order_status',
  'mcp__multi-tool-agent__calculate_discount',
];

// The SDK pulls from the input generator ahead of a turn fully finishing
// (it doesn't wait for the previous turn's `result` before requesting the
// next line). Without this gate, the REPL's next "You:" prompt could start
// racing calculate_discount's confirmation prompt on the same shared `rl`
// instance. Resolved from main()'s `result` handler once a turn is done.
let resolveTurnComplete;
function waitForTurnComplete() {
  return new Promise((resolve) => {
    resolveTurnComplete = resolve;
  });
}

// Streams each REPL line to the agent as a new user turn. Because this is
// passed as `prompt` to a single query() call (streaming-input mode), the
// SDK keeps one continuous session/history across every yielded message —
// there is no new conversation started per line.
async function* readUserMessages() {
  while (true) {
    const line = (await rl.question('\nYou: ')).trim();
    if (line.length === 0) {
      continue;
    }
    if (line.toLowerCase() === 'exit' || line.toLowerCase() === 'quit') {
      return;
    }
    console.log(`\n[user] ${line}`);
    yield {
      type: 'user',
      message: { role: 'user', content: line },
      parent_tool_use_id: null,
    };
    // Don't ask for the next line until this turn (including any nested
    // tool confirmation) has fully resolved.
    await waitForTurnComplete();
  }
}

async function main() {
  console.log('multi-tool-agent REPL. Ask about products, orders, or discounts. Type "exit" to quit.');

  const stream = query({
    prompt: readUserMessages(),
    options: {
      mcpServers: { 'multi-tool-agent': multiToolServer },
      allowedTools: ALLOWED_TOOLS,
      // Standard permission behavior for anything outside ALLOWED_TOOLS;
      // our own tools are pre-approved above, and calculate_discount has
      // its own explicit confirmation gate regardless of permission mode.
      permissionMode: 'default',
    },
  });

  for await (const message of stream) {
    switch (message.type) {
      case 'assistant':
        for (const block of message.message.content) {
          if (block.type === 'text') {
            console.log(`[assistant] ${block.text}`);
          } else if (block.type === 'tool_use') {
            console.log(`[tool_call] ${block.name} ${JSON.stringify(block.input)}`);
          }
        }
        break;

      // Tool results arrive as a "user" message containing tool_result blocks.
      case 'user':
        if (Array.isArray(message.message.content)) {
          for (const block of message.message.content) {
            if (block.type === 'tool_result') {
              const text = Array.isArray(block.content)
                ? block.content
                    .filter((part) => part.type === 'text')
                    .map((part) => part.text)
                    .join('\n')
                : String(block.content);
              console.log(`[tool_result]${block.is_error ? ' (error)' : ''} ${text}`);
            }
          }
        }
        break;

      case 'result':
        if (message.subtype === 'success') {
          console.log(`\n[final answer] ${message.result}`);
        } else {
          console.log(`\n[final answer:error] ${message.subtype}`);
        }
        // Unblock the input generator now that this turn is fully done.
        resolveTurnComplete?.();
        resolveTurnComplete = undefined;
        break;

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
    rl.close();
  });
