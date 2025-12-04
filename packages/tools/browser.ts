import type { Page } from "playwright";
import sharp from "sharp";
import { z } from "zod";

export interface ScreenshotData {
  base64: string;
  filename: string;
}

async function takeScreenshot(page: Page): Promise<ScreenshotData> {
  const rawBuffer = await page.screenshot({ type: "jpeg" });

  // Resize to exactly 896x896 with black padding to avoid MLX adding its own padding
  // This ensures consistent image sizes across all screenshots
  const compressedBuffer = await sharp(rawBuffer)
    .resize(896, 896, {
      fit: "contain", // Fit inside and add padding
      background: { r: 0, g: 0, b: 0 }, // Black padding
    })
    .jpeg({ quality: 80 })
    .toBuffer();

  // Debug: save screenshot to disk
  await Bun.write("/tmp/debug-screenshot.jpg", compressedBuffer);
  console.log("[DEBUG] Screenshot saved to /tmp/debug-screenshot.jpg");

  const base64 = compressedBuffer.toString("base64");
  return {
    base64,
    filename: `screenshot-${Date.now()}.jpg`,
  };
}

export const navigateSchema = z.object({
  url: z.string().url().describe("The URL to navigate to"),
});

export type NavigateInput = z.infer<typeof navigateSchema>;

export interface NavigateResult {
  message: string;
  screenshot: ScreenshotData;
}

export async function navigate(
  page: Page,
  input: NavigateInput
): Promise<NavigateResult> {
  const { url } = navigateSchema.parse(input);
  await page.goto(url, { waitUntil: "networkidle" });
  // Extra delay to ensure rendering is complete
  await page.waitForTimeout(500);
  return {
    message: `Navigated to ${url}`,
    screenshot: await takeScreenshot(page),
  };
}

export const getContentsSchema = z.object({
  selector: z
    .string()
    .optional()
    .describe(
      "Optional CSS selector to get contents from. If not provided, returns the entire page content."
    ),
});

export type GetContentsInput = z.infer<typeof getContentsSchema>;

export async function getContents(
  page: Page,
  input: GetContentsInput = {}
): Promise<string> {
  const { selector } = getContentsSchema.parse(input);

  if (selector) {
    const element = await page.$(selector);
    if (!element) {
      return `No element found matching selector: ${selector}`;
    }
    const text = await element.textContent();
    return text ?? "";
  }

  // Get visible text content instead of full HTML to avoid overwhelming the model
  const text = await page.evaluate(() => document.body.innerText);
  // Truncate if too long
  const maxLength = 10000;
  if (text.length > maxLength) {
    return text.slice(0, maxLength) + "\n\n[Content truncated...]";
  }
  return text;
}

export const reloadSchema = z.object({
  waitUntil: z
    .enum(["load", "domcontentloaded", "networkidle", "commit"])
    .optional()
    .default("domcontentloaded")
    .describe("When to consider the reload complete"),
});

export type ReloadInput = z.infer<typeof reloadSchema>;

export interface ReloadResult {
  message: string;
  screenshot: ScreenshotData;
}

export async function reload(
  page: Page,
  input: z.input<typeof reloadSchema> = {}
): Promise<ReloadResult> {
  const { waitUntil } = reloadSchema.parse(input);
  await page.reload({ waitUntil });
  // Extra delay to ensure rendering is complete
  await page.waitForTimeout(500);
  return {
    message: `Page reloaded (waited for ${waitUntil})`,
    screenshot: await takeScreenshot(page),
  };
}

export const queryElementViaCssSelectorSchema = z.object({
  selector: z.string().describe("The CSS selector to query"),
  attribute: z
    .string()
    .optional()
    .describe(
      "Optional attribute to retrieve from the element(s). If not provided, returns text content."
    ),
  all: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, returns all matching elements. Otherwise, returns only the first match."
    ),
});

export type QueryElementViaCssSelectorInput = z.infer<
  typeof queryElementViaCssSelectorSchema
>;

export interface QueryResult {
  found: boolean;
  count: number;
  results: Array<{
    index: number;
    value: string | null;
  }>;
}

export async function queryElementViaCssSelector(
  page: Page,
  input: QueryElementViaCssSelectorInput
): Promise<QueryResult> {
  const { selector, attribute, all } =
    queryElementViaCssSelectorSchema.parse(input);

  if (all) {
    const elements = await page.$$(selector);

    if (elements.length === 0) {
      return { found: false, count: 0, results: [] };
    }

    const results = await Promise.all(
      elements.map(async (element, index) => {
        const value = attribute
          ? await element.getAttribute(attribute)
          : await element.textContent();
        return { index, value };
      })
    );

    return { found: true, count: elements.length, results };
  }

  const element = await page.$(selector);

  if (!element) {
    return { found: false, count: 0, results: [] };
  }

  const value = attribute
    ? await element.getAttribute(attribute)
    : await element.textContent();

  return { found: true, count: 1, results: [{ index: 0, value }] };
}

// Screenshot tool
export const screenshotSchema = z.object({});

export type ScreenshotInput = z.infer<typeof screenshotSchema>;

export type ScreenshotResult = ScreenshotData;

export async function screenshot(page: Page): Promise<ScreenshotResult> {
  return takeScreenshot(page);
}

// Click tool
export const clickSchema = z.object({
  x: z
    .number()
    .describe("The x coordinate to click (pixels from left edge of viewport)"),
  y: z
    .number()
    .describe("The y coordinate to click (pixels from top edge of viewport)"),
  button: z
    .enum(["left", "right", "middle"])
    .optional()
    .default("left")
    .describe("Which mouse button to use"),
  clickCount: z
    .number()
    .optional()
    .default(1)
    .describe("Number of clicks (e.g., 2 for double-click)"),
});

export type ClickInput = z.infer<typeof clickSchema>;

export async function click(page: Page, input: ClickInput): Promise<string> {
  const { x, y, button, clickCount } = clickSchema.parse(input);
  await page.mouse.click(x, y, { button, clickCount });
  // Wait for any navigation or rendering triggered by the click
  await page.waitForTimeout(500);
  return `Clicked at coordinates (${x}, ${y})`;
}

// Scroll tool
export const scrollSchema = z.object({
  direction: z
    .enum(["up", "down", "left", "right"])
    .describe("Direction to scroll"),
  amount: z
    .number()
    .optional()
    .default(500)
    .describe("Amount to scroll in pixels"),
  selector: z
    .string()
    .optional()
    .describe(
      "Optional CSS selector to scroll within a specific element. If not provided, scrolls the page."
    ),
});

export type ScrollInput = z.infer<typeof scrollSchema>;

export async function scroll(page: Page, input: ScrollInput): Promise<string> {
  const { direction, amount, selector } = scrollSchema.parse(input);

  const deltaX =
    direction === "left" ? -amount : direction === "right" ? amount : 0;
  const deltaY =
    direction === "up" ? -amount : direction === "down" ? amount : 0;

  if (selector) {
    const element = await page.$(selector);
    if (!element) {
      return `No element found matching selector: ${selector}`;
    }
    await element.evaluate(
      (el, { dx, dy }) => {
        el.scrollBy(dx, dy);
      },
      { dx: deltaX, dy: deltaY }
    );
    return `Scrolled ${direction} by ${amount}px within element: ${selector}`;
  }

  await page.evaluate("([dx, dy]) => window.scrollBy(dx, dy)", [
    deltaX,
    deltaY,
  ]);
  return `Scrolled ${direction} by ${amount}px`;
}

// Type tool
export const typeSchema = z.object({
  selector: z
    .string()
    .describe("The CSS selector of the input element to type into"),
  text: z.string().describe("The text to type"),
  delay: z
    .number()
    .optional()
    .default(0)
    .describe(
      "Delay between key presses in milliseconds (useful for triggering autocomplete)"
    ),
  clear: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, clears the input before typing"),
});

export type TypeInput = z.infer<typeof typeSchema>;

export async function type(page: Page, input: TypeInput): Promise<string> {
  const { selector, text, delay, clear } = typeSchema.parse(input);
  const element = await page.$(selector);
  if (!element) {
    return `No element found matching selector: ${selector}`;
  }
  if (clear) {
    await element.fill("");
  }
  await element.type(text, { delay });
  return `Typed "${text}" into element: ${selector}`;
}
