import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;

const tools = [
  {
    name: "calculate",
    description:
      "Perform a basic arithmetic operation (add, subtract, multiply, divide) on two numbers.",
    input_schema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["add", "subtract", "multiply", "divide"],
          description: "The arithmetic operation to perform.",
        },
        a: { type: "number", description: "The first operand." },
        b: { type: "number", description: "The second operand." },
      },
      required: ["operation", "a", "b"],
    },
  },
];

function calculate(operation, a, b) {
  switch (operation) {
    case "add":
      return a + b;
    case "subtract":
      return a - b;
    case "multiply":
      return a * b;
    case "divide":
      if (b === 0) {
        throw new Error("Division by zero is not allowed.");
      }
      return a / b;
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

function executeTool(name, input) {
  if (name !== "calculate") {
    return { content: `Unknown tool: ${name}`, isError: true };
  }

  const { operation, a, b } = input;

  try {
    const result = calculate(operation, a, b);
    return { content: String(result), isError: false };
  } catch (err) {
    return { content: err.message, isError: true };
  }
}

async function runTurn(messages) {
  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      tools,
      tool_choice: { type: "auto" },
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      return response;
    }

    const toolUseBlocks = response.content.filter(
      (block) => block.type === "tool_use",
    );

    const toolResults = toolUseBlocks.map((block) => {
      const { content, isError } = executeTool(block.name, block.input);
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content,
        is_error: isError,
      };
    });

    messages.push({ role: "user", content: toolResults });
  }
}

function printFinalText(response) {
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  if (text) {
    console.log(text);
  }
}

async function main() {
  const rl = readline.createInterface({ input, output });
  const messages = [];

  console.log("Calculator agent ready. Type a message (Ctrl+C to exit).");

  while (true) {
    const line = await rl.question("> ");

    messages.push({ role: "user", content: line });

    const response = await runTurn(messages);
    printFinalText(response);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
