import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error(
    "Error: ANTHROPIC_API_KEY is not set. Add it to a .env file in this directory (see .env.example).",
  );
  process.exit(1);
}

const client = new Anthropic({ apiKey });

const stream = client.messages.stream({
  model: "claude-sonnet-5",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content:
        "Write a short, upbeat product description for an insulated water bottle.",
    },
  ],
});

stream.on("text", (text) => {
  process.stdout.write(text);
});

const finalMessage = await stream.finalMessage();
process.stdout.write("\n");
console.log(
  `input_tokens: ${finalMessage.usage.input_tokens}, output_tokens: ${finalMessage.usage.output_tokens}`,
);
