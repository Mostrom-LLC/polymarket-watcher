import { GoogleGenAI } from "@google/genai";

const clientsByApiKey = new Map<string, GoogleGenAI>();

export function getGeminiClient(apiKey: string): GoogleGenAI {
  const cachedClient = clientsByApiKey.get(apiKey);
  if (cachedClient) {
    return cachedClient;
  }

  const client = new GoogleGenAI({ apiKey });
  clientsByApiKey.set(apiKey, client);
  return client;
}
