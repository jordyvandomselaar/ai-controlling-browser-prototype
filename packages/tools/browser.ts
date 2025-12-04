import type { Page } from "playwright";
import { z } from "zod";

export const navigateSchema = z.object({
  url: z.string().url().describe("The URL to navigate to"),
});

export type NavigateInput = z.infer<typeof navigateSchema>;

export async function navigate(page: Page, input: NavigateInput): Promise<string> {
  const { url } = navigateSchema.parse(input);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return `Navigated to ${url}`;
}

export const getContentsSchema = z.object({
  selector: z
    .string()
    .optional()
    .describe("Optional CSS selector to get contents from. If not provided, returns the entire page content."),
});

export type GetContentsInput = z.infer<typeof getContentsSchema>;

export async function getContents(page: Page, input: GetContentsInput = {}): Promise<string> {
  const { selector } = getContentsSchema.parse(input);

  if (selector) {
    const element = await page.$(selector);
    if (!element) {
      return `No element found matching selector: ${selector}`;
    }
    const text = await element.textContent();
    return text ?? "";
  }

  return await page.content();
}

export const reloadSchema = z.object({
  waitUntil: z
    .enum(["load", "domcontentloaded", "networkidle", "commit"])
    .optional()
    .default("domcontentloaded")
    .describe("When to consider the reload complete"),
});

export type ReloadInput = z.infer<typeof reloadSchema>;

export async function reload(page: Page, input: z.input<typeof reloadSchema> = {}): Promise<string> {
  const { waitUntil } = reloadSchema.parse(input);
  await page.reload({ waitUntil });
  return `Page reloaded (waited for ${waitUntil})`;
}

export const queryElementViaCssSelectorSchema = z.object({
  selector: z.string().describe("The CSS selector to query"),
  attribute: z
    .string()
    .optional()
    .describe("Optional attribute to retrieve from the element(s). If not provided, returns text content."),
  all: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, returns all matching elements. Otherwise, returns only the first match."),
});

export type QueryElementViaCssSelectorInput = z.infer<typeof queryElementViaCssSelectorSchema>;

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
  const { selector, attribute, all } = queryElementViaCssSelectorSchema.parse(input);

  if (all) {
    const elements = await page.$$(selector);

    if (elements.length === 0) {
      return { found: false, count: 0, results: [] };
    }

    const results = await Promise.all(
      elements.map(async (element, index) => {
        const value = attribute ? await element.getAttribute(attribute) : await element.textContent();
        return { index, value };
      })
    );

    return { found: true, count: elements.length, results };
  }

  const element = await page.$(selector);

  if (!element) {
    return { found: false, count: 0, results: [] };
  }

  const value = attribute ? await element.getAttribute(attribute) : await element.textContent();

  return { found: true, count: 1, results: [{ index: 0, value }] };
}

