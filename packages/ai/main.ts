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
// Use 896x896 viewport to match the VLM's expected image size (no padding needed)
const page = await browser.newPage({ viewport: { width: 896, height: 896 } });

// Tool definitions as a string to include in the system prompt
const toolsDescription = `
You have access to these tools to browse the web:

1. navigate(url: string) - Navigate to a URL. Returns a screenshot.
2. screenshot() - Take a screenshot of the current page  
3. getContents(selector?: string) - Get text content of page or element
4. click(x: number, y: number) - Click at pixel coordinates on the page. The viewport is 896x896 pixels. Returns a screenshot.
5. scroll(direction: "up"|"down"|"left"|"right", amount?: number) - Scroll the page
6. type(selector: string, text: string) - Type into an input element by CSS selector
7. keyboard(text: string) - Type text directly using keyboard (click to focus first!)
8. press(key: string) - Press a key like "Enter", "Tab", "Escape"
9. reload() - Reload the page

To use a tool, respond with ONLY a JSON object like this:
{"tool": "navigate", "args": {"url": "https://example.com"}}
{"tool": "click", "args": {"x": 400, "y": 300}}
{"tool": "keyboard", "args": {"text": "search query"}}
{"tool": "press", "args": {"key": "Enter"}}

TYPING WORKFLOW: To type in a search box:
1. Click on the input field using coordinates: {"tool": "click", "args": {"x": 400, "y": 200}}
2. Type using keyboard: {"tool": "keyboard", "args": {"text": "your search"}}
3. Press Enter: {"tool": "press", "args": {"key": "Enter"}}

After I execute the tool, I'll show you the result (and a screenshot if applicable).
When you have enough information to answer, just respond normally without JSON.
`;

const systemPrompt = `You are a persistent web browsing agent with VISION. You can SEE screenshots and click on elements by their coordinates.

${toolsDescription}

VISION & CLICKING:
- After each navigation, you receive a screenshot of the page (896x896 pixels)
- LOOK at the screenshot to find buttons, links, and interactive elements
- To click something, estimate its x,y coordinates from the screenshot and use the click tool
- Example: If a button appears roughly in the center, click at x:448, y:448

HANDLING DIALOGS:
- Cookie consent: Look for "Accept", "Reject", "Decline" buttons and CLICK them using coordinates
- CAPTCHA/Robot check: Look for checkboxes or buttons and CLICK them
- Login walls: Try to find "Skip" or "Close" buttons

CRITICAL RULES:
1. NEVER answer without using tools first! You MUST navigate to URLs before you can see them.
2. If the user asks about an image URL, you MUST use navigate to go to that URL first.
3. LOOK at screenshots carefully - describe what you ACTUALLY SEE in the image
4. Use click(x, y) to interact with buttons and links you see in screenshots
5. BE PERSISTENT: If one source fails, try another
6. If blocked by a dialog, CLICK to dismiss it before continuing
7. PREFER DuckDuckGo (https://duckduckgo.com/?q=...) over Google - it has no cookie dialogs

IMPORTANT: Your FIRST response must ALWAYS be a tool call JSON. Never answer directly!`;

// Parse tool call from model response - can be anywhere in the content
function parseToolCall(
  content: string
): { tool: string; args: Record<string, unknown> } | null {
  // Try to find JSON object anywhere in the content
  const jsonMatch = content.match(
    /\{[^{}]*"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[^{}]*\}[^{}]*\}/
  );
  if (!jsonMatch) {
    // Try simpler pattern for empty args
    const simpleMatch = content.match(/\{[^{}]*"tool"\s*:\s*"[^"]+"[^{}]*\}/);
    if (!simpleMatch) return null;
    try {
      const parsed = JSON.parse(simpleMatch[0]);
      if (parsed.tool && typeof parsed.tool === "string") {
        return { tool: parsed.tool, args: parsed.args || {} };
      }
    } catch {
      return null;
    }
  }

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.tool && typeof parsed.tool === "string") {
        return { tool: parsed.tool, args: parsed.args || {} };
      }
    } catch {
      // Not valid JSON
    }
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
      try {
        const result = await navigate(page, { url: args.url as string });
        const image = await client.files.prepareImageBase64(
          result.screenshot.filename,
          result.screenshot.base64
        );
        return { result: result.message, image };
      } catch (error) {
        return {
          result: `Navigation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
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
      const clickResult = await click(page, {
        x: args.x as number,
        y: args.y as number,
        button: "left",
        clickCount: 1,
      });
      // Take a screenshot after clicking so model can see the result
      const screenshotResult = await screenshot(page);
      const image = await client.files.prepareImageBase64(
        screenshotResult.filename,
        screenshotResult.base64
      );
      return { result: clickResult, image };
    }
    case "scroll": {
      const result = await scroll(page, {
        direction: args.direction as "up" | "down" | "left" | "right",
        amount: (args.amount as number) ?? 500,
      });
      return { result };
    }
    case "type": {
      try {
        const result = await typeText(page, {
          selector: args.selector as string,
          text: args.text as string,
          delay: 0,
          clear: false,
        });
        return { result };
      } catch (error) {
        return {
          result: `Type failed: ${
            error instanceof Error ? error.message : String(error)
          }. Try clicking on the input field first, then use the keyboard tool.`,
        };
      }
    }
    case "keyboard": {
      // Type text directly using keyboard (after clicking to focus)
      await page.keyboard.type(args.text as string);
      const screenshotResult = await screenshot(page);
      const image = await client.files.prepareImageBase64(
        screenshotResult.filename,
        screenshotResult.base64
      );
      return { result: `Typed "${args.text}"`, image };
    }
    case "press": {
      // Press a key (Enter, Tab, etc.)
      await page.keyboard.press(args.key as string);
      const screenshotResult = await screenshot(page);
      const image = await client.files.prepareImageBase64(
        screenshotResult.filename,
        screenshotResult.base64
      );
      return { result: `Pressed ${args.key}`, image };
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
