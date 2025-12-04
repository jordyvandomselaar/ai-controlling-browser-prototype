import { tool } from "ai";
import type { Page } from "playwright";
import {
  navigate,
  navigateSchema,
  type NavigateInput,
  getContents,
  getContentsSchema,
  type GetContentsInput,
  reload,
  reloadSchema,
  type ReloadInput,
  queryElementViaCssSelector,
  queryElementViaCssSelectorSchema,
  type QueryElementViaCssSelectorInput,
  screenshot,
  screenshotSchema,
  type ScreenshotInput,
  click,
  clickSchema,
  type ClickInput,
  scroll,
  scrollSchema,
  type ScrollInput,
  type as typeText,
  typeSchema,
  type TypeInput,
} from "./browser.ts";

export function createBrowserTools(page: Page) {
  return {
    navigate: tool({
      description: "Navigate to a URL in the browser",
      inputSchema: navigateSchema,
      execute: async (input: NavigateInput) => navigate(page, input),
    }),

    getContents: tool({
      description:
        "Get the contents of the current page or a specific element. Returns HTML content of the page or text content of the selected element.",
      inputSchema: getContentsSchema,
      execute: async (input: GetContentsInput) => getContents(page, input),
    }),

    reload: tool({
      description: "Reload the current page",
      inputSchema: reloadSchema,
      execute: async (input: ReloadInput) => reload(page, input),
    }),

    queryElementViaCssSelector: tool({
      description:
        "Query elements on the page using a CSS selector. Can retrieve text content or specific attributes from one or all matching elements.",
      inputSchema: queryElementViaCssSelectorSchema,
      execute: async (input: QueryElementViaCssSelectorInput) =>
        queryElementViaCssSelector(page, input),
    }),

    screenshot: tool({
      description:
        "Take a screenshot of the current viewport. Returns a base64-encoded PNG image. Use this to see what the page looks like.",
      inputSchema: screenshotSchema,
      execute: async () => screenshot(page),
    }),

    click: tool({
      description:
        "Click at specific coordinates on the page (x, y pixels from top-left of viewport)",
      inputSchema: clickSchema,
      execute: async (input: ClickInput) => click(page, input),
    }),

    scroll: tool({
      description: "Scroll the page or a specific element in a given direction",
      inputSchema: scrollSchema,
      execute: async (input: ScrollInput) => scroll(page, input),
    }),

    type: tool({
      description: "Type text into an input element on the page",
      inputSchema: typeSchema,
      execute: async (input: TypeInput) => typeText(page, input),
    }),
  };
}

export type BrowserTools = ReturnType<typeof createBrowserTools>;
