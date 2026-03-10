import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import type { NormalizedMarket } from "../api/types.js";

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

/**
 * Topic Classifier Agent
 * 
 * Uses Gemini to classify markets by topic relevance.
 */
export class TopicClassifier {
  private client: GoogleGenAI;
  private model: string;
  private maxTokens: number;
  private temperature: number;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTtlMs: number;

  constructor(
    apiKey: string,
    options: { model?: string; maxTokens?: number; temperature?: number; cacheTtlMs?: number } = {}
  ) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = options.model ?? "gemini-2.5-flash";
    this.maxTokens = options.maxTokens ?? 512;
    this.temperature = options.temperature ?? 0.3;
    this.cacheTtlMs = options.cacheTtlMs ?? 60 * 60 * 1000; // 1 hour default
  }

  /**
   * Get cache key for a market/topics combination
   */
  private getCacheKey(marketId: string, topics: string[]): string {
    return `${marketId}:${topics.sort().join(",")}`;
  }

  /**
   * Check if cache entry is valid
   */
  private isCacheValid(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp < this.cacheTtlMs;
  }

  /**
   * Classify a single market against topics
   */
  async classifyMarket(
    market: NormalizedMarket,
    topics: string[]
  ): Promise<ClassificationResult> {
    // Check cache first
    const cacheKey = this.getCacheKey(market.id, topics);
    const cached = this.cache.get(cacheKey);
    if (cached && this.isCacheValid(cached)) {
      return cached.result;
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

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        maxOutputTokens: this.maxTokens,
        temperature: this.temperature,
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

      // Cache the result
      this.cache.set(cacheKey, { result, timestamp: Date.now() });

      return result;
    } catch (error) {
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

  /**
   * Batch classify multiple markets
   */
  async batchClassify(
    markets: NormalizedMarket[],
    topics: string[]
  ): Promise<ClassificationResult[]> {
    const results: ClassificationResult[] = [];

    for (const market of markets) {
      const result = await this.classifyMarket(market, topics);
      results.push(result);
      
      // Small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return results;
  }

  /**
   * Filter markets that match any of the given topics
   */
  async filterByTopics(
    markets: NormalizedMarket[],
    topics: string[],
    minScore: number = 50
  ): Promise<NormalizedMarket[]> {
    const results = await this.batchClassify(markets, topics);

    return results
      .filter((r) => r.isRelevant && r.relevanceScore >= minScore)
      .map((r) => r.market);
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; validEntries: number } {
    let validEntries = 0;
    for (const entry of this.cache.values()) {
      if (this.isCacheValid(entry)) {
        validEntries++;
      }
    }
    return { size: this.cache.size, validEntries };
  }
}
