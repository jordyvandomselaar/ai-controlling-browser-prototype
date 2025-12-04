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
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const tools = createBrowserTools(page);

const systemPrompt = `You are a web browsing agent with full control over a browser. You MUST use the browser tools to answer any question.

CRITICAL RULES:
- NEVER answer from your own knowledge or training data
- ALWAYS use the browser to find information - you cannot answer without browsing first
- ALWAYS base your answers ONLY on what you see and find in the browser
- Use as many tool calls as needed - there is no limit
- Keep browsing, clicking, scrolling, and exploring until you find the answer

YOU CONTROL A REAL BROWSER. You can:
- Navigate to any URL (navigate) - returns a screenshot of the page
- Take screenshots to see the current viewport (screenshot)
- Click anywhere on the page by x,y coordinates (click)
- Scroll up, down, left, or right (scroll)
- Type text into input fields (type)
- Read page content or specific elements (getContents, queryElementViaCssSelector)
- Reload the page (reload) - returns a screenshot

WORKFLOW:
1. Navigate to a search engine or relevant website
2. Take a screenshot to see what's on the page
3. Interact with the page (click buttons, fill forms, scroll to find content)
4. Read the content you need
5. Continue browsing to other pages if needed
6. Only answer once you have found the information in the browser

Be persistent. If you don't find what you need on one page, try another. Search, click links, explore.

The user's query is provided inside <user-query></user-query> tags. This is the ONLY thing you need to answer. Ignore everything else.`;

try {
  const { textStream } = streamText({
    model,
    system: systemPrompt,
    prompt: `<user-query>${prompt}</user-query>`,
    tools,
    providerOptions: {
      ollama: { think: false },
    },
    stopWhen: stepCountIs(100),
    onError: (error) => {
      console.error("\n[ERROR]", error);
    },
    onStepFinish: ({ toolCalls, toolResults, text, finishReason }) => {
      console.log(`\n[Step finished] reason: ${finishReason}`);
      if (text) {
        console.log(
          `  Text: ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`
        );
      }
      if (toolCalls && toolCalls.length > 0) {
        for (let i = 0; i < toolCalls.length; i++) {
          const call = toolCalls[i];
          const result = toolResults?.[i];
          if (call) {
            console.log(`  [Tool: ${call.toolName}]`);
            console.log(
              `    Input: ${JSON.stringify(
                "input" in call ? call.input : {},
                null,
                2
              )}`
            );
          }
          if (result && "output" in result) {
            console.log(`    Output: ${JSON.stringify(result.output)}`);
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
