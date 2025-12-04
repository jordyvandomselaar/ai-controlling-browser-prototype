import { streamText, model } from "./ai.ts";

const prompt = process.argv[2];

if (!prompt) {
  console.error("Usage: bun main.ts <prompt>");
  process.exit(1);
}

const { textStream } = streamText({
  model,
  prompt,
});

for await (const chunk of textStream) {
  process.stdout.write(chunk);
}

process.stdout.write("\n");
