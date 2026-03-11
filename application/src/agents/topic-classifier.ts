import { Type } from "@google/genai";
import { z } from "zod";
import type { NormalizedMarket } from "../api/types.js";
import { getGeminiClient } from "./gemini-client.js";

const classificationPayloadSchema = z.object({
  isRelevant: z.boolean().optional(),
  matchedTopics: z.array(z.string()).optional(),
  relevanceScore: z.number().optional(),
  reasoning: z.string().optional(),
});

const classificationResponseSchema = {
  type: Type.OBJECT,
  properties: {
    isRelevant: { type: Type.BOOLEAN },
    matchedTopics: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    relevanceScore: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ["isRelevant", "matchedTopics", "relevanceScore", "reasoning"],
};

function parseClassificationPayload(rawText: string) {
  const trimmed = rawText.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.match(/\{[\s\S]*\}/)?.[0];

  if (!jsonText) {
    throw new Error("No JSON found in response");
  }

  return classificationPayloadSchema.parse(JSON.parse(jsonText));
}

/**
 * Classification result for a single market
 */
export interface ClassificationResult {
  market: NormalizedMarket;
  isRelevant: boolean;
  matchedTopics: string[];
  relevanceScore: number; // 0-100
  reasoning: string;
}

/**
 * Cache entry for classification results
 */
interface CacheEntry {
  result: ClassificationResult;
  timestamp: number;
}

export interface TopicClassifierOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  cacheTtlMs?: number;
}

interface ResolvedTopicClassifierOptions {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  cacheTtlMs: number;
}

const topicClassificationCache = new Map<string, CacheEntry>();

function resolveTopicClassifierOptions(
  options: TopicClassifierOptions
): ResolvedTopicClassifierOptions {
  return {
    apiKey: options.apiKey,
    model: options.model ?? "gemini-2.5-flash",
    maxTokens: options.maxTokens ?? 512,
    temperature: options.temperature ?? 0.3,
    cacheTtlMs: options.cacheTtlMs ?? 60 * 60 * 1000,
  };
}

function getCacheKey(marketId: string, topics: string[]): string {
  return `${marketId}:${[...topics].sort().join(",")}`;
}

function isCacheValid(entry: CacheEntry, cacheTtlMs: number): boolean {
  return Date.now() - entry.timestamp < cacheTtlMs;
}

export async function classifyMarket(
  market: NormalizedMarket,
  topics: string[],
  options: TopicClassifierOptions
): Promise<ClassificationResult> {
  const resolvedOptions = resolveTopicClassifierOptions(options);
  const cacheKey = getCacheKey(market.id, topics);
  const cachedEntry = topicClassificationCache.get(cacheKey);

  if (cachedEntry && isCacheValid(cachedEntry, resolvedOptions.cacheTtlMs)) {
    return cachedEntry.result;
  }

  const prompt = `You are a market classification expert. Analyze this prediction market and determine its relevance to the given topics.

Market Question: ${market.question}
Outcomes: ${market.outcomes.join(", ")}
Current Prices: ${market.outcomePrices.map((p, i) => `${market.outcomes[i]}: ${(p * 100).toFixed(1)}%`).join(", ")}

Topics to check: ${topics.join(", ")}

Respond in JSON format:
{
  "isRelevant": true/false,
  "matchedTopics": ["topic1", "topic2"],
  "relevanceScore": 0-100,
  "reasoning": "Brief explanation"
}

Rules:
- isRelevant: true if relevanceScore >= 50
- matchedTopics: only topics that genuinely match
- relevanceScore: 0-100 based on how clearly the market relates to the topics
- reasoning: concise explanation`;

  const response = await getGeminiClient(resolvedOptions.apiKey).models.generateContent({
    model: resolvedOptions.model,
    contents: prompt,
    config: {
      maxOutputTokens: resolvedOptions.maxTokens,
      temperature: resolvedOptions.temperature,
      responseMimeType: "application/json",
      responseSchema: classificationResponseSchema,
    },
  });

  try {
    const parsed = parseClassificationPayload(response.text ?? "");
    const relevanceScore = Math.min(100, Math.max(0, parsed.relevanceScore ?? 0));

    const result: ClassificationResult = {
      market,
      isRelevant: parsed.isRelevant ?? relevanceScore >= 50,
      matchedTopics: parsed.matchedTopics ?? [],
      relevanceScore,
      reasoning: parsed.reasoning ?? "",
    };

    topicClassificationCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch {
    console.error("[TopicClassifier] Failed to parse response:", response.text ?? "unknown");
    return {
      market,
      isRelevant: false,
      matchedTopics: [],
      relevanceScore: 0,
      reasoning: "Failed to classify market",
    };
  }
}

export async function batchClassifyMarkets(
  markets: NormalizedMarket[],
  topics: string[],
  options: TopicClassifierOptions
): Promise<ClassificationResult[]> {
  const results: ClassificationResult[] = [];

  for (const market of markets) {
    results.push(await classifyMarket(market, topics, options));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return results;
}

export async function filterMarketsByTopics(
  markets: NormalizedMarket[],
  topics: string[],
  options: TopicClassifierOptions,
  minScore: number = 50
): Promise<NormalizedMarket[]> {
  const results = await batchClassifyMarkets(markets, topics, options);

  return results
    .filter((result) => result.isRelevant && result.relevanceScore >= minScore)
    .map((result) => result.market);
}

export function clearTopicClassificationCache(): void {
  topicClassificationCache.clear();
}

export function getTopicClassificationCacheStats(cacheTtlMs: number = 60 * 60 * 1000): {
  size: number;
  validEntries: number;
} {
  let validEntries = 0;
  for (const entry of topicClassificationCache.values()) {
    if (isCacheValid(entry, cacheTtlMs)) {
      validEntries++;
    }
  }

  return { size: topicClassificationCache.size, validEntries };
}
