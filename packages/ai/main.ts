import { chromium } from "playwright";
import { streamText, stepCountIs } from "ai";
import { model } from "./ai.ts";
import { createBrowserTools } from "@llm-browser-agent/tools";

const prompt = process.argv[2];

if (!prompt) {
  console.error("Usage: bun main.ts <prompt>");
  console.error(
    'Example: bun main.ts "Go to https://example.com and tell me what the page is about"'
  );
  process.exit(1);
}

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
const tools = createBrowserTools(page);

try {
  const { textStream } = streamText({
    model,
    prompt,
    tools,
    stopWhen: stepCountIs(10),
    onStepFinish: ({ toolCalls, toolResults }) => {
      if (toolCalls && toolCalls.length > 0) {
        for (let i = 0; i < toolCalls.length; i++) {
          const call = toolCalls[i];
          const result = toolResults?.[i];
          if (call) {
            console.log(`\n[Tool: ${call.toolName}]`);
            console.log(
              `  Input: ${JSON.stringify(
                "input" in call ? call.input : {},
                null,
                2
              )}`
            );
          }
          if (result && "output" in result) {
            const resultStr = JSON.stringify(result.output);
            const truncated =
              resultStr.length > 500
                ? resultStr.slice(0, 500) + "..."
                : resultStr;
            console.log(`  Output: ${truncated}`);
          }
        }
      }
    },
  });

  for await (const chunk of textStream) {
    process.stdout.write(chunk);
  }

  process.stdout.write("\n");
} finally {
  await browser.close();
}
