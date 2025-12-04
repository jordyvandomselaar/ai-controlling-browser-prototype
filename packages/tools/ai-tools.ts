import { type LMStudioClient, type FileHandle, type LLMTool } from "@lmstudio/sdk";
import type { Page } from "playwright";
import {
  navigate,
  getContents,
  reload,
  queryElementViaCssSelector,
  screenshot,
  click,
  scroll,
  type as typeText,
} from "./browser.ts";

export interface ToolResult {
  message: string;
  image?: FileHandle;
}

type ToolImplementation = (args: Record<string, unknown>) => Promise<string | ToolResult>;

export interface BrowserToolsResult {
  definitions: LLMTool[];
  implementations: Record<string, ToolImplementation>;
}

/**
 * Creates browser tools for LM Studio SDK.
 * Returns both tool definitions (for the model) and implementations (for execution).
 */
export function createBrowserTools(page: Page, client: LMStudioClient): BrowserToolsResult {
  const definitions: LLMTool[] = [
    {
      type: "function",
      function: {
        name: "navigate",
        description: "Navigate to a URL in the browser. Returns a screenshot of the page.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to navigate to" },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getContents",
        description: "Get the text contents of the current page or a specific element.",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "Optional CSS selector. If not provided, returns entire page text.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "reload",
        description: "Reload the current page. Returns a screenshot.",
        parameters: {
          type: "object",
          properties: {
            waitUntil: {
              type: "string",
              enum: ["load", "domcontentloaded", "networkidle", "commit"],
              description: "When to consider the reload complete.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "queryElementViaCssSelector",
        description: "Query elements on the page using a CSS selector.",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "The CSS selector to query" },
            attribute: {
              type: "string",
              description: "Optional attribute to retrieve. If not provided, returns text content.",
            },
            all: {
              type: "boolean",
              description: "If true, returns all matching elements.",
            },
          },
          required: ["selector"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "screenshot",
        description: "Take a screenshot of the current viewport.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "click",
        description: "Click at specific coordinates on the page.",
        parameters: {
          type: "object",
          properties: {
            x: { type: "number", description: "X coordinate (pixels from left)" },
            y: { type: "number", description: "Y coordinate (pixels from top)" },
            button: {
              type: "string",
              enum: ["left", "right", "middle"],
              description: "Which mouse button to use.",
            },
            clickCount: {
              type: "number",
              description: "Number of clicks (e.g., 2 for double-click).",
            },
          },
          required: ["x", "y"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "scroll",
        description: "Scroll the page or a specific element.",
        parameters: {
          type: "object",
          properties: {
            direction: {
              type: "string",
              enum: ["up", "down", "left", "right"],
              description: "Direction to scroll",
            },
            amount: { type: "number", description: "Amount to scroll in pixels." },
            selector: {
              type: "string",
              description: "Optional CSS selector to scroll within a specific element.",
            },
          },
          required: ["direction"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "type",
        description: "Type text into an input element on the page.",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector of the input element" },
            text: { type: "string", description: "The text to type" },
            delay: { type: "number", description: "Delay between key presses in ms." },
            clear: { type: "boolean", description: "If true, clears the input before typing." },
          },
          required: ["selector", "text"],
        },
      },
    },
  ];

  const implementations: Record<string, ToolImplementation> = {
    navigate: async (args) => {
      const result = await navigate(page, { url: args.url as string });
      const image = await client.files.prepareImageBase64(
        result.screenshot.filename,
        result.screenshot.base64
      );
      return { message: result.message, image };
    },

    getContents: async (args) => {
      return getContents(page, { selector: args.selector as string | undefined });
    },

    reload: async (args) => {
      const result = await reload(page, {
        waitUntil: args.waitUntil as "load" | "domcontentloaded" | "networkidle" | "commit" | undefined,
      });
      const image = await client.files.prepareImageBase64(
        result.screenshot.filename,
        result.screenshot.base64
      );
      return { message: result.message, image };
    },

    queryElementViaCssSelector: async (args) => {
      const result = await queryElementViaCssSelector(page, {
        selector: args.selector as string,
        attribute: args.attribute as string | undefined,
        all: (args.all as boolean) ?? false,
      });
      return JSON.stringify(result);
    },

    screenshot: async () => {
      const result = await screenshot(page);
      const image = await client.files.prepareImageBase64(
        result.filename,
        result.base64
      );
      return { message: "Screenshot taken", image };
    },

    click: async (args) => {
      return click(page, {
        x: args.x as number,
        y: args.y as number,
        button: (args.button as "left" | "right" | "middle") ?? "left",
        clickCount: (args.clickCount as number) ?? 1,
      });
    },

    scroll: async (args) => {
      return scroll(page, {
        direction: args.direction as "up" | "down" | "left" | "right",
        amount: (args.amount as number) ?? 500,
        selector: args.selector as string | undefined,
      });
    },

    type: async (args) => {
      return typeText(page, {
        selector: args.selector as string,
        text: args.text as string,
        delay: (args.delay as number) ?? 0,
        clear: (args.clear as boolean) ?? false,
      });
    },
  };

  return { definitions, implementations };
}

export type BrowserTools = ReturnType<typeof createBrowserTools>;
