import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { TopicClassifier, type ClassificationResult } from "./topic-classifier.js";
import type { NormalizedMarket } from "../api/types.js";

/**
 * Integration tests for TopicClassifier using REAL Gemini API
 * 
 * These tests call the actual Gemini API - no mocks allowed per TESTING.md
 * Uses GEMINI_API_KEY from environment
 * 
 * NOTE: Tests skip gracefully when rate limited (429 errors)
 */
describe("TopicClassifier (Integration)", () => {
  let classifier: TopicClassifier;
  const apiKey = process.env.GEMINI_API_KEY;

  const sampleMarket: NormalizedMarket = {
    id: "market-bitcoin-100k",
    question: "Will Bitcoin hit $100k by end of 2024?",
    slug: "bitcoin-100k-2024",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.65, 0.35],
    volume: 1000000,
    liquidity: 500000,
    endDate: new Date("2024-12-31"),
    active: true,
    closed: false,
    tokenIds: ["token-yes", "token-no"],
  };

  /**
   * Check if a result indicates rate limiting
   */
  function isRateLimited(result: ClassificationResult): boolean {
    return result.reasoning.toLowerCase().includes("rate limit");
  }

  beforeAll(() => {
    if (!apiKey) {
      console.warn("GEMINI_API_KEY not set - skipping integration tests");
    }
  });

  afterEach(() => {
    classifier?.clearCache();
  });

  describe("classifyMarket", () => {
    it("should classify a crypto market against crypto topics using real Gemini API", async () => {
      if (!apiKey) {
        console.log("Skipping: GEMINI_API_KEY not set");
        return;
      }

      classifier = new TopicClassifier(apiKey);
      // Use 0 retries to fail fast on rate limit
      const result = await classifier.classifyMarket(sampleMarket, ["cryptocurrency", "bitcoin", "finance"], 0);

      // Skip if rate limited
      if (isRateLimited(result)) {
        console.log("Skipping: Gemini API rate limited");
        return;
      }

      // Verify structure
      expect(result).toHaveProperty("market");
      expect(result).toHaveProperty("isRelevant");
      expect(result).toHaveProperty("matchedTopics");
      expect(result).toHaveProperty("relevanceScore");
      expect(result).toHaveProperty("reasoning");

      // This market should be classified as relevant to crypto topics
      expect(result.isRelevant).toBe(true);
      expect(result.relevanceScore).toBeGreaterThan(50);
      expect(result.matchedTopics.length).toBeGreaterThan(0);
      expect(result.reasoning).toBeTruthy();
    });

    it("should classify a politics market as not relevant to crypto topics", async () => {
      if (!apiKey) {
        console.log("Skipping: GEMINI_API_KEY not set");
        return;
      }

      const politicsMarket: NormalizedMarket = {
        ...sampleMarket,
        id: "market-election",
        question: "Will Joe Biden win the 2024 presidential election?",
        slug: "biden-2024-election",
      };

      classifier = new TopicClassifier(apiKey);
      // Use 0 retries to fail fast on rate limit
      const result = await classifier.classifyMarket(politicsMarket, ["cryptocurrency", "bitcoin"], 0);

      // Skip if rate limited
      if (isRateLimited(result)) {
        console.log("Skipping: Gemini API rate limited");
        return;
      }

      // Politics market should NOT be relevant to crypto topics
      expect(result.isRelevant).toBe(false);
      expect(result.relevanceScore).toBeLessThan(50);
    });
  });

  describe("batchClassify", () => {
    it("should classify multiple markets in batch", async () => {
      if (!apiKey) {
        console.log("Skipping: GEMINI_API_KEY not set");
        return;
      }

      const markets: NormalizedMarket[] = [
        sampleMarket,
        {
          ...sampleMarket,
          id: "market-eth",
          question: "Will Ethereum reach $10,000 by end of 2024?",
          slug: "eth-10k-2024",
        },
      ];

      classifier = new TopicClassifier(apiKey);
      // Pre-check for rate limit with single call (0 retries)
      const testResult = await classifier.classifyMarket(sampleMarket, ["cryptocurrency"], 0);
      if (isRateLimited(testResult)) {
        console.log("Skipping: Gemini API rate limited");
        return;
      }
      classifier.clearCache();
      
      const results = await classifier.batchClassify(markets, ["cryptocurrency"]);

      // Skip if rate limited
      if (results.some(isRateLimited)) {
        console.log("Skipping: Gemini API rate limited");
        return;
      }

      expect(results).toHaveLength(2);
      // Both should be crypto-relevant
      expect(results[0]?.isRelevant).toBe(true);
      expect(results[1]?.isRelevant).toBe(true);
    });
  });

  describe("cache", () => {
    it("should cache results and return cached values on second call", async () => {
      if (!apiKey) {
        console.log("Skipping: GEMINI_API_KEY not set");
        return;
      }

      classifier = new TopicClassifier(apiKey, { cacheTtlMs: 60000 });
      
      // First call - hits API (0 retries to fail fast)
      const result1 = await classifier.classifyMarket(sampleMarket, ["crypto"], 0);
      
      // Skip if rate limited
      if (isRateLimited(result1)) {
        console.log("Skipping: Gemini API rate limited");
        return;
      }
      
      // Second call - should use cache
      const result2 = await classifier.classifyMarket(sampleMarket, ["crypto"], 0);

      // Results should be identical (from cache)
      expect(result2.relevanceScore).toBe(result1.relevanceScore);
      expect(result2.reasoning).toBe(result1.reasoning);

      // Cache should have entry
      const stats = classifier.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.validEntries).toBe(1);
    });

    it("should return cache stats", () => {
      classifier = new TopicClassifier(apiKey ?? "dummy-key");
      const stats = classifier.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.validEntries).toBe(0);
    });
  });

  describe("filterByTopics", () => {
    it("should filter markets to only relevant ones", async () => {
      if (!apiKey) {
        console.log("Skipping: GEMINI_API_KEY not set");
        return;
      }

      const markets: NormalizedMarket[] = [
        sampleMarket, // Crypto market
        {
          ...sampleMarket,
          id: "market-sports",
          question: "Will the Lakers win the NBA championship?",
          slug: "lakers-nba-2024",
        },
      ];

      classifier = new TopicClassifier(apiKey);
      
      // Pre-check for rate limiting (no retries to fail fast)
      const testResult = await classifier.classifyMarket(sampleMarket, ["cryptocurrency"], 0);
      if (isRateLimited(testResult)) {
        console.log("Skipping: Gemini API rate limited");
        return;
      }
      classifier.clearCache(); // Clear cache so the actual test runs fresh
      const filtered = await classifier.filterByTopics(markets, ["cryptocurrency", "bitcoin"], 50);

      // Only crypto market should pass filter
      expect(filtered.length).toBe(1);
      expect(filtered[0]?.id).toBe("market-bitcoin-100k");
    });
  });
});
