import { describe, it, expect, vi, beforeEach } from "vitest";
import { TopicClassifier } from "./topic-classifier.js";
import { WhaleAnalyzer } from "./whale-analyzer.js";
import { isAiAvailable } from "./index.js";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";

// Mock Anthropic to avoid real API calls
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn(),
      };
    },
  };
});

describe("Optional AI Features", () => {
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

  // Trade volume is size * price
  // For hasWhaleActivity to be true, totalVolume must be > 100000
  const sampleTrades: NormalizedTrade[] = [
    {
      id: "trade-1",
      marketId: "market-1",
      tokenId: "token-yes",
      side: "BUY",
      size: 200000, // 200000 * 0.65 = 130000
      price: 0.65,
      timestamp: new Date(),
      outcome: "Yes",
      traderAddress: "0x123",
    },
    {
      id: "trade-2",
      marketId: "market-1",
      tokenId: "token-no",
      side: "BUY",
      size: 50000, // 50000 * 0.35 = 17500
      price: 0.35,
      timestamp: new Date(),
      outcome: "No",
      traderAddress: "0x456",
    },
  ];

  describe("isAiAvailable", () => {
    it("should return true when API key is provided", () => {
      expect(isAiAvailable("sk-ant-test-key")).toBe(true);
    });

    it("should return false when API key is undefined", () => {
      expect(isAiAvailable(undefined)).toBe(false);
    });

    it("should return false when API key is empty string", () => {
      expect(isAiAvailable("")).toBe(false);
    });
  });

  describe("TopicClassifier without API key", () => {
    let classifier: TopicClassifier;

    beforeEach(() => {
      classifier = new TopicClassifier(undefined);
    });

    it("should report AI as disabled", () => {
      expect(classifier.isAiEnabled()).toBe(false);
    });

    it("should return pass-through results for classifyMarket", async () => {
      const result = await classifier.classifyMarket(sampleMarket, ["crypto", "bitcoin"]);

      expect(result.isRelevant).toBe(true);
      expect(result.matchedTopics).toEqual(["crypto", "bitcoin"]);
      expect(result.relevanceScore).toBe(100);
      expect(result.reasoning).toContain("AI classification disabled");
      expect(result.market.id).toBe("market-1");
    });

    it("should return pass-through results for batchClassify", async () => {
      const markets = [sampleMarket, { ...sampleMarket, id: "market-2" }];
      const results = await classifier.batchClassify(markets, ["crypto"]);

      expect(results).toHaveLength(2);
      expect(results[0]?.isRelevant).toBe(true);
      expect(results[1]?.isRelevant).toBe(true);
    });

    it("should return all markets for filterByTopics", async () => {
      const markets = [sampleMarket, { ...sampleMarket, id: "market-2" }];
      const filtered = await classifier.filterByTopics(markets, ["crypto"], 50);

      expect(filtered).toHaveLength(2);
    });
  });

  describe("TopicClassifier with API key", () => {
    let classifier: TopicClassifier;

    beforeEach(() => {
      classifier = new TopicClassifier("sk-ant-test-key");
    });

    it("should report AI as enabled", () => {
      expect(classifier.isAiEnabled()).toBe(true);
    });
  });

  describe("WhaleAnalyzer without API key", () => {
    let analyzer: WhaleAnalyzer;

    beforeEach(() => {
      analyzer = new WhaleAnalyzer(undefined);
    });

    it("should report AI as disabled", () => {
      expect(analyzer.isAiEnabled()).toBe(false);
    });

    it("should return basic analysis for analyzeTrades", async () => {
      const result = await analyzer.analyzeTrades(sampleMarket, sampleTrades);

      expect(result.hasWhaleActivity).toBe(true); // Total volume > 100k
      expect(result.largestBets).toHaveLength(2);
      expect(result.marketLean).toBe("YES"); // YES volume > NO volume * 1.2
      expect(result.recommendation).toBe("HOLD");
      expect(result.confidence).toBe("LOW");
      expect(result.reasoning).toContain("AI analysis disabled");
    });

    it("should handle empty trades", async () => {
      const result = await analyzer.analyzeTrades(sampleMarket, []);

      expect(result.hasWhaleActivity).toBe(false);
      expect(result.largestBets).toHaveLength(0);
      expect(result.reasoning).toBe("No trades to analyze");
    });

    it("should detect NEUTRAL market lean when volumes are close", async () => {
      const balancedTrades: NormalizedTrade[] = [
        {
          id: "trade-1",
          marketId: "market-1",
          tokenId: "token-yes",
          side: "BUY",
          size: 50000,
          price: 0.5,
          timestamp: new Date(),
          outcome: "Yes",
          traderAddress: "0x123",
        },
        {
          id: "trade-2",
          marketId: "market-1",
          tokenId: "token-no",
          side: "BUY",
          size: 50000,
          price: 0.5,
          timestamp: new Date(),
          outcome: "No",
          traderAddress: "0x456",
        },
      ];

      const result = await analyzer.analyzeTrades(sampleMarket, balancedTrades);

      expect(result.marketLean).toBe("NEUTRAL");
    });
  });

  describe("WhaleAnalyzer with API key", () => {
    let analyzer: WhaleAnalyzer;

    beforeEach(() => {
      analyzer = new WhaleAnalyzer("sk-ant-test-key");
    });

    it("should report AI as enabled", () => {
      expect(analyzer.isAiEnabled()).toBe(true);
    });
  });
});
