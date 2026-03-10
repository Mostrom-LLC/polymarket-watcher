import { GoogleGenerativeAI } from "@google/generative-ai";
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
 * Uses Gemini to classify markets by topic relevance.
 */
export class TopicClassifier {
  private client: GoogleGenerativeAI;
  private model: string;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTtlMs: number;

  constructor(
    apiKey: string,
    options: { model?: string; cacheTtlMs?: number } = {}
  ) {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = options.model ?? "gemini-2.0-flash";
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
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("429") || message.includes("Too Many Requests") || message.includes("quota");
  }

  /**
   * Classify a single market against topics with retry logic
   */
  async classifyMarket(
    market: NormalizedMarket,
    topics: string[],
    maxRetries: number = 3
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

Respond in JSON format only (no markdown code blocks):
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

    let lastError: unknown;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const model = this.client.getGenerativeModel({ model: this.model });
        const response = await model.generateContent(prompt);
        const text = response.response.text();

        const jsonMatch = text.match(/\{[\s\S]*\}/);
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
        lastError = error;
        
        // Only retry on rate limit errors
        if (this.isRateLimitError(error) && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
          console.warn(`[TopicClassifier] Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await this.sleep(delay);
          continue;
        }
        
        // Non-retryable error or max retries reached
        break;
      }
    }

    const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
    const isRateLimit = this.isRateLimitError(lastError);
    console.error(`[TopicClassifier] Failed to classify: ${errorMessage}`);
    
    return {
      market,
      isRelevant: false,
      matchedTopics: [],
      relevanceScore: 0,
      reasoning: isRateLimit ? "Rate limit exceeded - classification unavailable" : "Failed to classify market",
    };
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
