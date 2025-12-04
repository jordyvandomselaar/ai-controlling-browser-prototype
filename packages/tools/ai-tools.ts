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
      execute: async (input: QueryElementViaCssSelectorInput) => queryElementViaCssSelector(page, input),
    }),
  };
}

export type BrowserTools = ReturnType<typeof createBrowserTools>;

