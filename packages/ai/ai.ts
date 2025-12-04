import { LMStudioClient } from "@lmstudio/sdk";

export const client = new LMStudioClient();

// Get the model - this will use the currently loaded model in LM Studio
// or you can specify a specific model like "google/gemma-3-12b"
export async function getModel(modelIdentifier?: string) {
  if (modelIdentifier) {
    return client.llm.model(modelIdentifier);
  }
  // Use any loaded model
  return client.llm.model();
}
