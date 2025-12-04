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

const systemPrompt = `You are a web browsing agent that controls a real browser. You have VISION - you can see screenshots of web pages and interact with them.

## YOUR CAPABILITIES

You control a browser with a 896x896 pixel viewport. After each action, you receive a screenshot showing what the browser displays.

## AVAILABLE TOOLS

To use a tool, respond with ONLY a JSON object (no other text before or after):

### 1. navigate - Go to a URL
{"tool": "navigate", "args": {"url": "https://example.com"}}
- Use this to visit any website or image URL
- Returns a screenshot of the loaded page

### 2. click - Click at coordinates  
{"tool": "click", "args": {"x": 448, "y": 300}}
- x: horizontal position (0 = left edge, 896 = right edge)
- y: vertical position (0 = top edge, 896 = bottom edge)
- Returns a screenshot after clicking

### 3. keyboard - Type text
{"tool": "keyboard", "args": {"text": "hello world"}}
- Types text at the current cursor position
- IMPORTANT: Click on an input field first to focus it!

### 4. press - Press a key
{"tool": "press", "args": {"key": "Enter"}}
- Keys: "Enter", "Tab", "Escape", "Backspace", "ArrowDown", "ArrowUp"

### 5. scroll - Scroll the page
{"tool": "scroll", "args": {"direction": "down", "amount": 500}}
- direction: "up", "down", "left", "right"
- amount: pixels to scroll (default 500)

### 6. getContents - Get page text
{"tool": "getContents", "args": {}}
- Returns the text content of the page
- Optional: {"tool": "getContents", "args": {"selector": "h1"}} for specific element

### 7. screenshot - Take a new screenshot
{"tool": "screenshot", "args": {}}

### 8. reload - Reload the page
{"tool": "reload", "args": {}}

## COORDINATE SYSTEM

The viewport is 896x896 pixels:
- Top-left corner: (0, 0)
- Center: (448, 448)  
- Bottom-right corner: (896, 896)

When you see a button or link in a screenshot, estimate its center coordinates:
- If something is in the left third: x ≈ 150
- If something is in the center: x ≈ 448
- If something is in the right third: x ≈ 750
- If something is near the top: y ≈ 100-200
- If something is in the middle: y ≈ 400-500
- If something is near the bottom: y ≈ 700-800

## WORKFLOW EXAMPLES

### Example 1: Describe an image URL
User: "What is this image? https://example.com/photo.jpg"

Step 1 - Navigate to the image:
{"tool": "navigate", "args": {"url": "https://example.com/photo.jpg"}}

Step 2 - After seeing the screenshot, describe what you ACTUALLY SEE in the image.

### Example 2: Research a topic thoroughly
User: "Who is Albert Einstein?"

Step 1 - Search on DuckDuckGo:
{"tool": "navigate", "args": {"url": "https://duckduckgo.com/?q=Albert+Einstein"}}

Step 2 - Look at the search results screenshot. Find a promising link (Wikipedia, official site, etc.) and click on it to get detailed information:
{"tool": "click", "args": {"x": 300, "y": 250}}

Step 3 - Read the actual article page. Use getContents to extract text:
{"tool": "getContents", "args": {}}

Step 4 - If you need more information, scroll down or visit another source:
{"tool": "scroll", "args": {"direction": "down", "amount": 500}}

Step 5 - Visit a second source for verification (e.g., another search result):
{"tool": "navigate", "args": {"url": "https://duckduckgo.com/?q=Albert+Einstein+biography"}}

Step 6 - Click on a different result to cross-reference:
{"tool": "click", "args": {"x": 300, "y": 350}}

Step 7 - Only after visiting multiple sources and gathering detailed information, provide your comprehensive answer.

### Example 3: Find a person's information
User: "Who is John Smith from Acme Corp?"

Step 1 - Search on DuckDuckGo:
{"tool": "navigate", "args": {"url": "https://duckduckgo.com/?q=John+Smith+Acme+Corp"}}

Step 2 - Click on their LinkedIn profile if visible:
{"tool": "click", "args": {"x": 300, "y": 200}}

Step 3 - If LinkedIn shows a login wall, go back and try another source:
{"tool": "navigate", "args": {"url": "https://duckduckgo.com/?q=John+Smith+Acme+Corp"}}

Step 4 - Try their company website:
{"tool": "navigate", "args": {"url": "https://acmecorp.com/team"}}

Step 5 - Read the page content:
{"tool": "getContents", "args": {}}

Step 6 - Compile information from multiple sources into your answer.

### Example 4: Handle cookie consent dialogs
When you see a cookie banner with "Accept" or "Reject" buttons:
1. Look at the screenshot to find the button position
2. Click on it: {"tool": "click", "args": {"x": 200, "y": 400}}
3. Then continue with your task

## CRITICAL RULES

1. **ALWAYS USE TOOLS FIRST**: Never answer questions without browsing first. Your first response must be a tool call.

2. **NAVIGATE BEFORE DESCRIBING**: To see any URL (including images), you MUST navigate to it first.

3. **TRUST YOUR EYES**: When you receive a screenshot, describe ONLY what you actually see. Do not hallucinate or make up content.

4. **ONE TOOL PER RESPONSE**: Output exactly one JSON tool call per response. No text before or after the JSON.

5. **BE PERSISTENT**: If a page doesn't load or shows an error, try:
   - A different URL
   - Scrolling to find content
   - Clicking to dismiss dialogs
   - Using DuckDuckGo instead of Google

6. **HANDLE DIALOGS**: Cookie banners, login prompts, and popups are common. Look at the screenshot and click buttons to dismiss them.

7. **PREFER DUCKDUCKGO**: Use https://duckduckgo.com/?q=your+search instead of Google to avoid cookie dialogs.

8. **VISIT ACTUAL WEBSITES**: Don't just read search result snippets! Click on links to visit the actual websites and read the full content. Search results only show summaries - you need to visit the pages to get detailed information.

9. **USE MULTIPLE SOURCES**: For research questions, visit at least 2-3 different websites to gather comprehensive information. Cross-reference facts between sources.

10. **READ PAGE CONTENT**: After navigating to a page, use getContents to read the text. Screenshots show what it looks like, but getContents gives you the actual text to read.

## WHEN TO STOP

Stop using tools and give your final answer when:
- You have visited multiple sources and gathered detailed information
- You have described what you see in an image (after navigating to it)
- You have completed the requested action

Your final response should be plain text (no JSON) with a comprehensive answer based on all the sources you visited.`;


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
      // Screenshot already includes click indicator showing where we clicked
      const image = await client.files.prepareImageBase64(
        clickResult.screenshot.filename,
        clickResult.screenshot.base64
      );
      return { result: clickResult.message, image };
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
