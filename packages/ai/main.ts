import { chromium } from "playwright";
import { LMStudioClient, Chat, FileHandle } from "@lmstudio/sdk";
import {
  navigate,
  getContents,
  screenshot,
  labeledScreenshot,
  click,
  clickByLabel,
  setLastDetectedElements,
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
let page = await browser.newPage({ viewport: { width: 896, height: 896 } });

const systemPrompt = `You are a web browsing agent that controls a real browser. You have VISION - you can see screenshots of web pages with NUMBERED LABELS on clickable elements.

## YOUR CAPABILITIES

You control a browser with a 896x896 pixel viewport. After each action, you receive a screenshot with numbered labels [1], [2], [3], etc. on clickable elements (buttons, links, inputs).

## AVAILABLE TOOLS

To use a tool, respond with ONLY a JSON object (no other text before or after):

### 1. navigate - Go to a URL
{"tool": "navigate", "args": {"url": "https://example.com"}}
- Use this to visit any website or image URL
- Returns a labeled screenshot showing clickable elements

### 2. clickByLabel - Click a numbered element (PREFERRED)
{"tool": "clickByLabel", "args": {"label": 5}}
- Click the element with label [5] shown in the screenshot
- This is the EASIEST and most ACCURATE way to click!
- Returns a new labeled screenshot after clicking

### 3. click - Click at coordinates (fallback)
{"tool": "click", "args": {"x": 448, "y": 300}}
- Only use if clickByLabel doesn't work
- x: horizontal position (0 = left, 896 = right)
- y: vertical position (0 = top, 896 = bottom)

### 4. keyboard - Type text
{"tool": "keyboard", "args": {"text": "hello world"}}
- Types text at the current cursor position
- IMPORTANT: Click on an input field first to focus it!

### 5. press - Press a key
{"tool": "press", "args": {"key": "Enter"}}
- Keys: "Enter", "Tab", "Escape", "Backspace", "ArrowDown", "ArrowUp"

### 6. scroll - Scroll the page
{"tool": "scroll", "args": {"direction": "down", "amount": 500}}
- direction: "up", "down", "left", "right"
- amount: pixels to scroll (default 500)

### 7. getContents - Get page text
{"tool": "getContents", "args": {}}
- Returns the text content of the page

### 8. labeledScreenshot - Get a fresh labeled screenshot
{"tool": "labeledScreenshot", "args": {}}
- Use this to refresh the element labels after scrolling

### 9. reload - Reload the page
{"tool": "reload", "args": {}}

## HOW TO READ LABELED SCREENSHOTS

Screenshots show numbered labels on clickable elements. Labels are COLOR-CODED by type:

🔵 **BLUE labels** = Links (navigation to other pages)
🟢 **GREEN labels** = Input fields (text boxes, search bars, forms)
🟠 **ORANGE labels** = Buttons (submit, click actions)
🟣 **PURPLE labels** = Other interactive elements (menus, dropdowns)

Each element has:
- A colored box outline around the element
- A colored circle with a white number at the top-left

Use clickByLabel with the number to click that element:
{"tool": "clickByLabel", "args": {"label": 3}}

**IMPORTANT**: Blue labels are LINKS that navigate to new pages. Green labels are INPUT FIELDS where you can type text.

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

Step 2 - Look at the labeled screenshot. Find the Wikipedia link (e.g., label [4]) and click it:
{"tool": "clickByLabel", "args": {"label": 4}}

Step 3 - Read the article. Use getContents to extract text:
{"tool": "getContents", "args": {}}

Step 4 - Scroll down for more information:
{"tool": "scroll", "args": {"direction": "down", "amount": 500}}

Step 5 - Get fresh labels after scrolling:
{"tool": "labeledScreenshot", "args": {}}

Step 6 - Visit another source for verification. Go back to search:
{"tool": "navigate", "args": {"url": "https://duckduckgo.com/?q=Albert+Einstein+biography"}}

Step 7 - Click on a different result (e.g., label [3]):
{"tool": "clickByLabel", "args": {"label": 3}}

Step 8 - Only after visiting multiple sources, provide your comprehensive answer.

### Example 3: Handle cookie consent dialogs
When you see a cookie banner:
1. Look for "Accept" or "Reject" button labels in the screenshot
2. Click it using the label: {"tool": "clickByLabel", "args": {"label": 2}}
3. Continue with your task

### Example 4: Fill out a search form
Step 1 - Navigate to the site:
{"tool": "navigate", "args": {"url": "https://google.com"}}

Step 2 - Find the search input (look for input[search] or input[text] label):
{"tool": "clickByLabel", "args": {"label": 1}}

Step 3 - Type your search:
{"tool": "keyboard", "args": {"text": "cats"}}

Step 4 - Press Enter:
{"tool": "press", "args": {"key": "Enter"}}

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

// Helper to get color indicator for element type
function getColorIndicator(type: string): string {
  if (type === "link") return "🔵"; // Blue for links
  if (type.startsWith("input[") || type === "textarea" || type === "select")
    return "🟢"; // Green for inputs
  if (type === "button") return "🟠"; // Orange for buttons
  return "🟣"; // Purple for other
}

// Helper to format element list for the model
function formatElementList(
  elements: Array<{ label: number; type: string; text: string }>
): string {
  if (elements.length === 0) {
    return "No clickable elements detected on this page.";
  }
  const lines = elements.map(
    (el) =>
      `${getColorIndicator(el.type)} [${el.label}] ${el.type}: "${
        el.text || "(no text)"
      }"`
  );
  return `Clickable elements (🔵=link, 🟢=input, 🟠=button, 🟣=other):\n${lines.join(
    "\n"
  )}`;
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
        const navResult = await navigate(page, { url: args.url as string });
        // Take a labeled screenshot after navigation
        const result = await labeledScreenshot(page);
        setLastDetectedElements(result.elements);
        const image = await client.files.prepareImageBase64(
          result.filename,
          result.base64
        );
        const elementList = formatElementList(result.elements);
        return {
          result: `${navResult.message}\n\n${elementList}`,
          image,
        };
      } catch (error) {
        return {
          result: `Navigation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }
    case "labeledScreenshot": {
      const result = await labeledScreenshot(page);
      setLastDetectedElements(result.elements);
      const image = await client.files.prepareImageBase64(
        result.filename,
        result.base64
      );
      const elementList = formatElementList(result.elements);
      return { result: `Labeled screenshot taken.\n\n${elementList}`, image };
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
    case "clickByLabel": {
      const result = await clickByLabel(page, {
        label: args.label as number,
      });
      // If a new tab was opened, switch to it
      if (result.newPage) {
        page = result.newPage;
      }
      setLastDetectedElements(result.screenshot.elements);
      const image = await client.files.prepareImageBase64(
        result.screenshot.filename,
        result.screenshot.base64
      );
      const elementList = formatElementList(result.screenshot.elements);
      return { result: `${result.message}\n\n${elementList}`, image };
    }
    case "click": {
      const clickResult = await click(page, {
        x: args.x as number,
        y: args.y as number,
        button: "left",
        clickCount: 1,
      });
      // After clicking, take a labeled screenshot
      const labeled = await labeledScreenshot(page);
      setLastDetectedElements(labeled.elements);
      const image = await client.files.prepareImageBase64(
        labeled.filename,
        labeled.base64
      );
      const elementList = formatElementList(labeled.elements);
      return { result: `${clickResult.message}\n\n${elementList}`, image };
    }
    case "scroll": {
      const result = await scroll(page, {
        direction: args.direction as "up" | "down" | "left" | "right",
        amount: (args.amount as number) ?? 500,
      });
      // After scrolling, take a labeled screenshot to show new elements
      const labeled = await labeledScreenshot(page);
      setLastDetectedElements(labeled.elements);
      const image = await client.files.prepareImageBase64(
        labeled.filename,
        labeled.base64
      );
      const elementList = formatElementList(labeled.elements);
      return { result: `${result}\n\n${elementList}`, image };
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
      const labeled = await labeledScreenshot(page);
      setLastDetectedElements(labeled.elements);
      const image = await client.files.prepareImageBase64(
        labeled.filename,
        labeled.base64
      );
      const elementList = formatElementList(labeled.elements);
      return { result: `Typed "${args.text}"\n\n${elementList}`, image };
    }
    case "press": {
      // Press a key (Enter, Tab, etc.)
      await page.keyboard.press(args.key as string);
      const labeled = await labeledScreenshot(page);
      setLastDetectedElements(labeled.elements);
      const image = await client.files.prepareImageBase64(
        labeled.filename,
        labeled.base64
      );
      const elementList = formatElementList(labeled.elements);
      return { result: `Pressed ${args.key}\n\n${elementList}`, image };
    }
    case "reload": {
      const result = await reload(page, {});
      const labeled = await labeledScreenshot(page);
      setLastDetectedElements(labeled.elements);
      const image = await client.files.prepareImageBase64(
        labeled.filename,
        labeled.base64
      );
      const elementList = formatElementList(labeled.elements);
      return { result: `${result.message}\n\n${elementList}`, image };
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

  const maxRounds = 100;
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
