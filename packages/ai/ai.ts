import { ollama } from "ollama-ai-provider-v2";

export { generateText, generateObject, streamText, streamObject } from "ai";
export type {
  CoreMessage,
  CoreUserMessage,
  CoreAssistantMessage,
  CoreSystemMessage,
  CoreToolMessage,
  ToolCallPart,
  ToolResultPart,
  TextPart,
  ImagePart,
} from "ai";

export const model = ollama("ministral-3:8b");

export { ollama };
