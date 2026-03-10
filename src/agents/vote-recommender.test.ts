import { describe, it, expect, vi, beforeEach } from "vitest";
import { VoteRecommender } from "./vote-recommender.js";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";

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

describe("VoteRecommender", () => {
  const sampleMarket: NormalizedMarket = {
    id: "market-1",
    question: "Will Bitcoin hit $100k?",
    slug: "bitcoin-100k",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.65, 0.35],
    volume: 1000000,
    liquidity: 500000,
    endDate: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
    active: true,
    closed: false,
    tokenIds: ["token-yes", "token-no"],
  };

  const sampleTrades: NormalizedTrade[] = [
    {
      id: "trade-1",
      marketId: "market-1",
      tokenId: "token-yes",
      side: "BUY",
      size: 100000,
      price: 0.65,
      timestamp: new Date(),
      outcome: "Yes",
      traderAddress: "0x123",
    },
  ];

  describe("without API key", () => {
    let recommender: VoteRecommender;

    beforeEach(() => {
      recommender = new VoteRecommender(undefined);
    });

    it("should report AI as disabled", () => {
      expect(recommender.isAiEnabled()).toBe(false);
    });

    it("should return basic recommendation for high YES odds", async () => {
      const highYesMarket = { ...sampleMarket, outcomePrices: [0.85, 0.15] };
      const result = await recommender.getRecommendation(highYesMarket);

      expect(result.recommendation).toBe("VOTE_YES");
      expect(result.confidence).toBe("HIGH");
      expect(result.formatted).toContain("Vote YES");
      expect(result.formatted).toContain("High confidence");
    });

    it("should return basic recommendation for high NO odds", async () => {
      const highNoMarket = { ...sampleMarket, outcomePrices: [0.10, 0.90] };
      const result = await recommender.getRecommendation(highNoMarket);

      expect(result.recommendation).toBe("VOTE_NO");
      expect(result.confidence).toBe("HIGH"); // >= 85% NO
      expect(result.formatted).toContain("Vote NO");
    });

    it("should return HOLD for close odds", async () => {
      const closeMarket = { ...sampleMarket, outcomePrices: [0.52, 0.48] };
      const result = await recommender.getRecommendation(closeMarket);

      expect(result.recommendation).toBe("HOLD");
      expect(result.confidence).toBe("LOW");
      expect(result.formatted).toContain("Hold/Skip");
    });

    it("should return MEDIUM confidence for moderate odds", async () => {
      const moderateMarket = { ...sampleMarket, outcomePrices: [0.72, 0.28] };
      const result = await recommender.getRecommendation(moderateMarket);

      expect(result.recommendation).toBe("VOTE_YES");
      expect(result.confidence).toBe("MEDIUM");
    });
  });

  describe("with API key", () => {
    let recommender: VoteRecommender;

    beforeEach(() => {
      recommender = new VoteRecommender("sk-ant-test-key");
    });

    it("should report AI as enabled", () => {
      expect(recommender.isAiEnabled()).toBe(true);
    });

    it("should return AI recommendation when available", async () => {
      const mockResponse = {
        content: [{
          type: "text",
          text: JSON.stringify({
            recommendation: "VOTE_YES",
            confidence: "HIGH",
            reasoning: "Strong market consensus with high volume.",
          }),
        }],
      };

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockInstance = new Anthropic();
      (mockInstance.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);
      (recommender as unknown as { client: typeof mockInstance }).client = mockInstance;

      const result = await recommender.getRecommendation(sampleMarket, sampleTrades);

      expect(result.recommendation).toBe("VOTE_YES");
      expect(result.confidence).toBe("HIGH");
      expect(result.reasoning).toBe("Strong market consensus with high volume.");
      expect(result.formatted).toContain("Vote YES");
    });

    it("should fall back to basic recommendation on AI error", async () => {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockInstance = new Anthropic();
      (mockInstance.messages.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("API Error"));
      (recommender as unknown as { client: typeof mockInstance }).client = mockInstance;

      const highYesMarket = { ...sampleMarket, outcomePrices: [0.85, 0.15] };
      const result = await recommender.getRecommendation(highYesMarket);

      // Should fall back to basic recommendation
      expect(result.recommendation).toBe("VOTE_YES");
      expect(result.confidence).toBe("HIGH");
    });

    it("should fall back on invalid JSON response", async () => {
      const mockResponse = {
        content: [{
          type: "text",
          text: "This is not valid JSON",
        }],
      };

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const mockInstance = new Anthropic();
      (mockInstance.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);
      (recommender as unknown as { client: typeof mockInstance }).client = mockInstance;

      const highYesMarket = { ...sampleMarket, outcomePrices: [0.85, 0.15] };
      const result = await recommender.getRecommendation(highYesMarket);

      expect(result.recommendation).toBe("VOTE_YES");
    });
  });
});
