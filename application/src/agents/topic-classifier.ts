import Anthropic from "@anthropic-ai/sdk";
import type { NormalizedMarket } from "../api/types.js";

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
 * Uses Claude Haiku to classify markets by topic relevance.
 */
export class TopicClassifier {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTtlMs: number;

  constructor(
    apiKey: string,
    options: { model?: string; maxTokens?: number; cacheTtlMs?: number } = {}
  ) {
    this.client = new Anthropic({ apiKey });
    this.model = options.model ?? "claude-3-5-haiku-20241022";
    this.maxTokens = options.maxTokens ?? 512;
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

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0];
    if (!content || content.type !== "text") {
      throw new Error("Unexpected response type from Claude");
    }

    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        isRelevant: boolean;
        matchedTopics: string[];
        relevanceScore: number;
        reasoning: string;
      };

      const result: ClassificationResult = {
        market,
        isRelevant: parsed.isRelevant ?? parsed.relevanceScore >= 50,
        matchedTopics: parsed.matchedTopics ?? [],
        relevanceScore: Math.min(100, Math.max(0, parsed.relevanceScore ?? 0)),
        reasoning: parsed.reasoning ?? "",
      };

      // Cache the result
      this.cache.set(cacheKey, { result, timestamp: Date.now() });

      return result;
    } catch (error) {
      const errorText = content.type === "text" ? content.text : "unknown";
      console.error("[TopicClassifier] Failed to parse response:", errorText);
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
