import type { Page } from "playwright";
import sharp from "sharp";
import { z } from "zod";

export interface ScreenshotData {
  base64: string;
  filename: string;
}

interface ClickIndicator {
  x: number;
  y: number;
}

export interface LabeledElement {
  label: number;
  type: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabeledScreenshotData extends ScreenshotData {
  elements: LabeledElement[];
}

async function takeScreenshot(
  page: Page,
  clickIndicator?: ClickIndicator
): Promise<ScreenshotData> {
  const rawBuffer = await page.screenshot({ type: "jpeg" });

  // Resize to exactly 896x896 with black padding to avoid MLX adding its own padding
  // This ensures consistent image sizes across all screenshots
  let pipeline = sharp(rawBuffer).resize(896, 896, {
    fit: "contain", // Fit inside and add padding
    background: { r: 0, g: 0, b: 0 }, // Black padding
  });

  // If click indicator is provided, draw a red dot at the click location
  if (clickIndicator) {
    const { x, y } = clickIndicator;
    const dotSize = 20; // Diameter of the dot
    const halfDot = dotSize / 2;

    // Create a red circle SVG overlay
    const circleSvg = Buffer.from(`
      <svg width="896" height="896">
        <circle cx="${x}" cy="${y}" r="${halfDot}" fill="red" stroke="white" stroke-width="3"/>
        <circle cx="${x}" cy="${y}" r="3" fill="white"/>
      </svg>
    `);

    pipeline = pipeline.composite([{ input: circleSvg, top: 0, left: 0 }]);
  }

  const compressedBuffer = await pipeline.jpeg({ quality: 80 }).toBuffer();

  // Debug: save screenshot to disk
  await Bun.write("/tmp/debug-screenshot.jpg", compressedBuffer);
  console.log("[DEBUG] Screenshot saved to /tmp/debug-screenshot.jpg");

  const base64 = compressedBuffer.toString("base64");
  return {
    base64,
    filename: `screenshot-${Date.now()}.jpg`,
  };
}

/**
 * Detect clickable elements on the page and return their bounding boxes
 */
async function detectClickableElements(page: Page): Promise<LabeledElement[]> {
  const elements = await page.evaluate(() => {
    const clickableSelectors = [
      "a[href]",
      "button",
      'input[type="button"]',
      'input[type="submit"]',
      'input[type="text"]',
      'input[type="search"]',
      'input[type="email"]',
      'input[type="password"]',
      "textarea",
      "select",
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="tab"]',
      "[onclick]",
      "[tabindex]",
    ];

    const allElements = document.querySelectorAll(clickableSelectors.join(","));
    const results: Array<{
      type: string;
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];

    allElements.forEach((el) => {
      const rect = el.getBoundingClientRect();

      // Skip elements that are not visible or too small
      if (
        rect.width < 10 ||
        rect.height < 10 ||
        rect.top < 0 ||
        rect.left < 0 ||
        rect.bottom > window.innerHeight ||
        rect.right > window.innerWidth
      ) {
        return;
      }

      // Skip elements with no visible area
      const style = window.getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return;
      }

      // Get element type
      const tagName = el.tagName.toLowerCase();
      let type = tagName;
      if (tagName === "input") {
        type = `input[${(el as HTMLInputElement).type}]`;
      } else if (tagName === "a") {
        type = "link";
      }

      // Get text content (truncate if too long)
      let text =
        (el as HTMLElement).innerText ||
        (el as HTMLInputElement).value ||
        (el as HTMLElement).getAttribute("aria-label") ||
        (el as HTMLElement).getAttribute("title") ||
        (el as HTMLElement).getAttribute("placeholder") ||
        "";
      text = text.trim().substring(0, 50);
      if (text.length === 50) text += "...";

      results.push({
        type,
        text,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    });

    // Sort by position (top to bottom, left to right)
    results.sort((a, b) => {
      if (Math.abs(a.y - b.y) < 20) {
        return a.x - b.x;
      }
      return a.y - b.y;
    });

    // Limit to first 30 elements to avoid overwhelming the model
    return results.slice(0, 30);
  });

  // Add labels (1-indexed for human readability)
  return elements.map((el, index) => ({
    ...el,
    label: index + 1,
  }));
}

/**
 * Get color for element type
 * - Blue (#3B82F6): Links - clickable navigation elements
 * - Green (#22C55E): Inputs/textareas - text entry fields
 * - Orange (#F97316): Buttons - action elements
 * - Purple (#A855F7): Other interactive elements (divs with onclick, etc.)
 */
function getElementColor(type: string): string {
  if (type === "link") {
    return "#3B82F6"; // Blue for links
  }
  if (type.startsWith("input[") || type === "textarea" || type === "select") {
    return "#22C55E"; // Green for inputs
  }
  if (type === "button") {
    return "#F97316"; // Orange for buttons
  }
  return "#A855F7"; // Purple for other interactive elements
}

/**
 * Take a screenshot with numbered labels on clickable elements
 * Colors indicate element type:
 * - Blue: Links (navigation)
 * - Green: Inputs (text entry)
 * - Orange: Buttons (actions)
 * - Purple: Other interactive elements
 */
async function takeLabeledScreenshot(
  page: Page
): Promise<LabeledScreenshotData> {
  const elements = await detectClickableElements(page);
  const rawBuffer = await page.screenshot({ type: "jpeg" });

  // Resize to exactly 896x896 with black padding
  let pipeline = sharp(rawBuffer).resize(896, 896, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0 },
  });

  // Create SVG overlay with numbered labels (color-coded by type)
  if (elements.length > 0) {
    const svgParts: string[] = [];

    for (const el of elements) {
      const color = getElementColor(el.type);

      // Draw a semi-transparent box around the element
      svgParts.push(
        `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="none" stroke="${color}" stroke-width="2" rx="3"/>`
      );

      // Draw a label circle with number at top-left of element
      const labelX = Math.max(12, el.x);
      const labelY = Math.max(12, el.y);
      svgParts.push(
        `<circle cx="${labelX}" cy="${labelY}" r="12" fill="${color}"/>`
      );
      svgParts.push(
        `<text x="${labelX}" y="${
          labelY + 4
        }" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="white">${
          el.label
        }</text>`
      );
    }

    const labelsSvg = Buffer.from(
      `<svg width="896" height="896" xmlns="http://www.w3.org/2000/svg">${svgParts.join(
        ""
      )}</svg>`
    );

    pipeline = pipeline.composite([{ input: labelsSvg, top: 0, left: 0 }]);
  }

  const compressedBuffer = await pipeline.jpeg({ quality: 80 }).toBuffer();

  // Debug: save screenshot to disk
  await Bun.write("/tmp/debug-screenshot-labeled.jpg", compressedBuffer);
  console.log(
    "[DEBUG] Labeled screenshot saved to /tmp/debug-screenshot-labeled.jpg"
  );

  const base64 = compressedBuffer.toString("base64");
  return {
    base64,
    filename: `screenshot-labeled-${Date.now()}.jpg`,
    elements,
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

  let message = `Navigated to ${url}`;

  try {
    // Use a short timeout (3 seconds) - if page doesn't load quickly, we still want to see what's there
    await page.goto(url, { waitUntil: "networkidle", timeout: 3000 });
  } catch (error) {
    // If timeout or navigation error, still take a screenshot of whatever loaded
    if (error instanceof Error && error.message.includes("Timeout")) {
      message = `Navigation to ${url} timed out after 3s, but page may have partially loaded`;
    } else {
      message = `Navigation to ${url} had an issue: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
    }
  }

  // Always take a screenshot, even if navigation had issues
  return {
    message,
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

// Labeled screenshot tool - shows numbered clickable elements
export const labeledScreenshotSchema = z.object({});

export type LabeledScreenshotInput = z.infer<typeof labeledScreenshotSchema>;

export type LabeledScreenshotResult = LabeledScreenshotData;

export async function labeledScreenshot(
  page: Page
): Promise<LabeledScreenshotResult> {
  return takeLabeledScreenshot(page);
}

// Click by label tool - click on a numbered element
export const clickByLabelSchema = z.object({
  label: z
    .number()
    .describe(
      "The label number of the element to click (from labeled screenshot)"
    ),
});

export type ClickByLabelInput = z.infer<typeof clickByLabelSchema>;

export interface ClickByLabelResult {
  message: string;
  screenshot: LabeledScreenshotData;
  newPage?: Page; // If a new tab was opened, this is the new page
}

// Store the last detected elements for click-by-label
let lastDetectedElements: LabeledElement[] = [];

export function setLastDetectedElements(elements: LabeledElement[]): void {
  lastDetectedElements = elements;
}

export async function clickByLabel(
  page: Page,
  input: ClickByLabelInput
): Promise<ClickByLabelResult> {
  const { label } = clickByLabelSchema.parse(input);

  const element = lastDetectedElements.find((el) => el.label === label);

  if (!element) {
    // Take a new labeled screenshot to show current state
    const newScreenshot = await takeLabeledScreenshot(page);
    lastDetectedElements = newScreenshot.elements;
    return {
      message: `Element with label ${label} not found. Available labels: ${lastDetectedElements
        .map((e) => e.label)
        .join(", ")}`,
      screenshot: newScreenshot,
    };
  }

  // Click at the center of the element
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;

  // If it's a link, we might navigate or open a new tab - need special handling
  const isLink = element.type === "link";

  // Get the browser context to detect new pages/tabs
  const context = page.context();

  if (isLink) {
    // Listen for new pages (tabs) that might open
    const newPagePromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);

    // Also listen for navigation in current page
    const navigationPromise = page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5000 })
      .catch(() => null);

    // Click the link
    await page.mouse.click(centerX, centerY);

    // Wait for either new tab or navigation
    const [newPage, navigationResult] = await Promise.all([
      newPagePromise,
      navigationPromise,
    ]);

    // If a new tab opened, switch to it
    if (newPage) {
      // Wait for the new page to load
      await newPage.waitForLoadState("domcontentloaded").catch(() => {});
      await newPage.waitForTimeout(500);

      // Close the old page and update our reference
      // Note: We need to return the new page somehow - for now, bring it to front
      await newPage.bringToFront();

      // Take screenshot from the NEW page
      const newScreenshot = await takeLabeledScreenshot(newPage);
      lastDetectedElements = newScreenshot.elements;

      return {
        message: `Clicked element [${label}] "${element.text}" (${element.type}) - opened in new tab at ${newPage.url()}`,
        screenshot: newScreenshot,
        newPage, // Return the new page so caller can update their reference
      };
    }

    // Extra wait for page to fully settle
    await page.waitForTimeout(500);
  } else {
    await page.mouse.click(centerX, centerY);
    await page.waitForTimeout(500);
  }

  // Take a new labeled screenshot after clicking (with retry for navigation edge cases)
  let newScreenshot: LabeledScreenshotData | null = null;
  for (let retry = 0; retry < 3; retry++) {
    try {
      newScreenshot = await takeLabeledScreenshot(page);
      break;
    } catch {
      // If context was destroyed, wait a bit more and retry
      if (retry === 2) {
        throw new Error("Failed to take screenshot after clicking");
      }
      await page.waitForTimeout(1000);
    }
  }

  if (!newScreenshot) {
    throw new Error("Failed to take screenshot after clicking");
  }
  lastDetectedElements = newScreenshot.elements;

  return {
    message: `Clicked element [${label}] "${element.text}" (${
      element.type
    }) at (${Math.round(centerX)}, ${Math.round(centerY)})`,
    screenshot: newScreenshot,
  };
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

export interface ClickResult {
  message: string;
  screenshot: ScreenshotData;
}

export async function click(
  page: Page,
  input: ClickInput
): Promise<ClickResult> {
  const { x, y, button, clickCount } = clickSchema.parse(input);
  await page.mouse.click(x, y, { button, clickCount });
  // Wait for any navigation or rendering triggered by the click
  await page.waitForTimeout(500);
  // Take screenshot with click indicator showing where we clicked
  const screenshotWithIndicator = await takeScreenshot(page, { x, y });
  return {
    message: `Clicked at coordinates (${x}, ${y})`,
    screenshot: screenshotWithIndicator,
  };
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
