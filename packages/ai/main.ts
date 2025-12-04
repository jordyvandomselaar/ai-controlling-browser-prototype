import { chromium } from "playwright";
import { LMStudioClient, Chat, FileHandle } from "@lmstudio/sdk";
import {
  navigate,
  getContents,
  screenshot,
  click,
  scroll,
  type as typeText,
  reload,
} from "@llm-browser-agent/tools";

const prompt = process.argv[2];

if (!prompt) {
  console.error("Usage: bun main.ts <prompt>");
  console.error(
    'Example: bun main.ts "Go to https://example.com and tell me what the page is about"'
  );
  process.exit(1);
}

const client = new LMStudioClient();
const model = await client.llm.model();

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });

// Tool definitions as a string to include in the system prompt
const toolsDescription = `
You have access to these tools to browse the web:

1. navigate(url: string) - Navigate to a URL
2. screenshot() - Take a screenshot of the current page  
3. getContents(selector?: string) - Get text content of page or element
4. click(x: number, y: number) - Click at coordinates
5. scroll(direction: "up"|"down"|"left"|"right", amount?: number) - Scroll the page
6. type(selector: string, text: string) - Type into an input
7. reload() - Reload the page

To use a tool, respond with ONLY a JSON object like this:
{"tool": "navigate", "args": {"url": "https://example.com"}}

After I execute the tool, I'll show you the result (and a screenshot if applicable).
When you have enough information to answer, just respond normally without JSON.
`;

const systemPrompt = `You are a web browsing agent. You MUST use tools to browse the web. You cannot answer questions without first using tools.

${toolsDescription}

CRITICAL RULES:
1. You MUST use the navigate tool to go to any URL before you can see it
2. You CANNOT see or describe images without first navigating to them
3. ALWAYS respond with a tool call JSON first - never answer directly
4. When you see a screenshot, describe what you ACTUALLY SEE - do not hallucinate`;

// Parse tool call from model response
function parseToolCall(
  content: string
): { tool: string; args: Record<string, unknown> } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.tool && typeof parsed.tool === "string") {
      return { tool: parsed.tool, args: parsed.args || {} };
    }
  } catch {
    // Not valid JSON, not a tool call
  }
  return null;
}

// Execute a tool and return result + optional image
async function executeTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<{ result: string; image?: FileHandle }> {
  console.log(`  [Tool: ${toolName}]`);
  console.log(`    Args: ${JSON.stringify(args)}`);

  switch (toolName) {
    case "navigate": {
      const result = await navigate(page, { url: args.url as string });
      const image = await client.files.prepareImageBase64(
        result.screenshot.filename,
        result.screenshot.base64
      );
      return { result: result.message, image };
    }
    case "screenshot": {
      const result = await screenshot(page);
      const image = await client.files.prepareImageBase64(
        result.filename,
        result.base64
      );
      return { result: "Screenshot taken", image };
    }
    case "getContents": {
      const result = await getContents(page, {
        selector: args.selector as string | undefined,
      });
      return { result };
    }
    case "click": {
      const result = await click(page, {
        x: args.x as number,
        y: args.y as number,
        button: "left",
        clickCount: 1,
      });
      return { result };
    }
    case "scroll": {
      const result = await scroll(page, {
        direction: args.direction as "up" | "down" | "left" | "right",
        amount: (args.amount as number) ?? 500,
      });
      return { result };
    }
    case "type": {
      const result = await typeText(page, {
        selector: args.selector as string,
        text: args.text as string,
        delay: 0,
        clear: false,
      });
      return { result };
    }
    case "reload": {
      const result = await reload(page, {});
      const image = await client.files.prepareImageBase64(
        result.screenshot.filename,
        result.screenshot.base64
      );
      return { result: result.message, image };
    }
    default:
      return { result: `Unknown tool: ${toolName}` };
  }
}

try {
  console.log("[Starting agent...]");

  const chat = Chat.from([
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ]);

  const maxRounds = 10;
  for (let round = 0; round < maxRounds; round++) {
    console.log(`\n[Round ${round + 1}]`);

    // Get model response
    const result = await model.respond(chat, {
      onPredictionFragment: (fragment) => {
        if (fragment.content) {
          process.stdout.write(fragment.content);
        }
      },
    });

    const content = result.content;
    chat.append("assistant", content);

    // Check if it's a tool call
    const toolCall = parseToolCall(content);
    if (!toolCall) {
      // Not a tool call - final response
      console.log("\n");
      break;
    }

    // Execute the tool
    const { result: toolResult, image } = await executeTool(
      toolCall.tool,
      toolCall.args
    );
    console.log(`    Result: ${toolResult}`);

    // Add tool result as user message, with image if available
    if (image) {
      chat.append(
        "user",
        `Tool result: ${toolResult}\n\nHere is the screenshot:`,
        { images: [image] }
      );
      console.log(`    [Screenshot attached]`);
    } else {
      chat.append("user", `Tool result: ${toolResult}`);
    }
  }

  console.log("[Done]");
} catch (error) {
  console.error("\n[ERROR]", error);
} finally {
  await browser.close();
}
