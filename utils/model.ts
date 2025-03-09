import { createAzure } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";
export const azureProvider = createAzure();

export const aliProvider = createOpenAI({
    apiKey: process.env.ALI_API_KEY,
    baseURL: process.env.ALI_BASE_URL
  });
  
  export const aliModel = (apiIdentifier: string) => {
    return aliProvider(apiIdentifier);
  };


export const LLMClient = azureProvider("gpt-4o");