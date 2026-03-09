import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TopicClassifier } from "./topic-classifier.js";
import type { NormalizedMarket } from "../api/types.js";

// Mock Anthropic
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn(),
      };
    },
  };
});

describe("TopicClassifier", () => {
  let classifier: TopicClassifier;
  let mockCreate: ReturnType<typeof vi.fn>;

  const sampleMarket: NormalizedMarket = {
    id: "market-1",
    question: "Will Bitcoin hit $100k by March 31?",
    slug: "bitcoin-100k-march",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.65, 0.35],
    volume: 1000000,
    liquidity: 500000,
    endDate: new Date("2024-03-31"),
    active: true,
    closed: false,
    tokenIds: ["token-yes", "token-no"],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    classifier = new TopicClassifier("test-api-key", { cacheTtlMs: 100 });
    
    // Get mock from the Anthropic instance
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const instance = new Anthropic();
    mockCreate = instance.messages.create as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    classifier.clearCache();
  });

  describe("classifyMarket", () => {
    it("should classify a market and return results", async () => {
      const mockResponse = {
        content: [{
          type: "text",
          text: JSON.stringify({
            isRelevant: true,
            matchedTopics: ["crypto", "bitcoin"],
            relevanceScore: 85,
            reasoning: "Market directly about Bitcoin price",
          }),
        }],
      };

      // Create a new classifier with fresh mock
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockInstance = new Anthropic();
      (mockInstance.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const freshClassifier = new TopicClassifier("test-api-key");
      // Manually inject the mock
      (freshClassifier as unknown as { client: { messages: { create: typeof vi.fn } } }).client = mockInstance;

      const result = await freshClassifier.classifyMarket(sampleMarket, ["crypto", "politics"]);

      expect(result.isRelevant).toBe(true);
      expect(result.matchedTopics).toContain("crypto");
      expect(result.relevanceScore).toBe(85);
      expect(result.market.id).toBe("market-1");
    });

    it("should return default values on parse error", async () => {
      const mockResponse = {
        content: [{
          type: "text",
          text: "Invalid JSON response",
        }],
      };

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockInstance = new Anthropic();
      (mockInstance.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const freshClassifier = new TopicClassifier("test-api-key");
      (freshClassifier as unknown as { client: { messages: { create: typeof vi.fn } } }).client = mockInstance;

      const result = await freshClassifier.classifyMarket(sampleMarket, ["crypto"]);

      expect(result.isRelevant).toBe(false);
      expect(result.matchedTopics).toEqual([]);
      expect(result.relevanceScore).toBe(0);
    });
  });

  describe("batchClassify", () => {
    it("should classify multiple markets", async () => {
      const markets = [sampleMarket, { ...sampleMarket, id: "market-2" }];

      const mockResponse = {
        content: [{
          type: "text",
          text: JSON.stringify({
            isRelevant: true,
            matchedTopics: ["crypto"],
            relevanceScore: 75,
            reasoning: "Related to crypto",
          }),
        }],
      };

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockInstance = new Anthropic();
      (mockInstance.messages.create as ReturnType<typeof vi.fn>)
        .mockResolvedValue(mockResponse);

      const freshClassifier = new TopicClassifier("test-api-key");
      (freshClassifier as unknown as { client: { messages: { create: typeof vi.fn } } }).client = mockInstance;

      const results = await freshClassifier.batchClassify(markets, ["crypto"]);

      expect(results).toHaveLength(2);
      expect(results[0]?.isRelevant).toBe(true);
      expect(results[1]?.isRelevant).toBe(true);
    });
  });

  describe("cache", () => {
    it("should cache results and return cached values", async () => {
      const mockResponse = {
        content: [{
          type: "text",
          text: JSON.stringify({
            isRelevant: true,
            matchedTopics: ["crypto"],
            relevanceScore: 80,
            reasoning: "Cached result",
          }),
        }],
      };

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockInstance = new Anthropic();
      const mockFn = mockInstance.messages.create as ReturnType<typeof vi.fn>;
      mockFn.mockResolvedValue(mockResponse);

      const freshClassifier = new TopicClassifier("test-api-key", { cacheTtlMs: 60000 });
      (freshClassifier as unknown as { client: { messages: { create: typeof vi.fn } } }).client = mockInstance;

      // First call - should hit API
      await freshClassifier.classifyMarket(sampleMarket, ["crypto"]);
      
      // Second call - should use cache
      const result2 = await freshClassifier.classifyMarket(sampleMarket, ["crypto"]);

      expect(result2.isRelevant).toBe(true);
      expect(mockFn).toHaveBeenCalledTimes(1); // Only called once due to cache
    });

    it("should return cache stats", async () => {
      const stats = classifier.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.validEntries).toBe(0);
    });
  });

  describe("filterByTopics", () => {
    it("should filter markets by relevance score", async () => {
      const markets = [
        sampleMarket,
        { ...sampleMarket, id: "market-2", question: "US Election 2024" },
      ];

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockInstance = new Anthropic();
      const mockFn = mockInstance.messages.create as ReturnType<typeof vi.fn>;

      // First market is relevant
      mockFn.mockResolvedValueOnce({
        content: [{
          type: "text",
          text: JSON.stringify({
            isRelevant: true,
            matchedTopics: ["crypto"],
            relevanceScore: 80,
            reasoning: "Crypto related",
          }),
        }],
      });

      // Second market is not relevant
      mockFn.mockResolvedValueOnce({
        content: [{
          type: "text",
          text: JSON.stringify({
            isRelevant: false,
            matchedTopics: [],
            relevanceScore: 20,
            reasoning: "Not crypto related",
          }),
        }],
      });

      const freshClassifier = new TopicClassifier("test-api-key");
      (freshClassifier as unknown as { client: { messages: { create: typeof vi.fn } } }).client = mockInstance;

      const filtered = await freshClassifier.filterByTopics(markets, ["crypto"], 50);

      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.id).toBe("market-1");
    });
  });
});
