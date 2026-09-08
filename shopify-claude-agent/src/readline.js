import readline from "node:readline";

export const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export function ask(promptText) {
  return new Promise((resolve) => {
    rl.question(promptText, resolve);
  });
}
