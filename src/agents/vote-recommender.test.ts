import { describe, it, expect, beforeAll } from "vitest";
import { VoteRecommender } from "./vote-recommender.js";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";

/**
 * Vote Recommender Tests
 * 
 * These tests use REAL Gemini API calls per TESTING_STANDARDS.md.
 * No mocks allowed for external services.
 */
describe("VoteRecommender", () => {
  const sampleMarket: NormalizedMarket = {
    id: "market-1",
    question: "Will Bitcoin hit $100k by end of 2026?",
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

  describe("without API key (basic mode)", () => {
    let recommender: VoteRecommender;

    beforeAll(() => {
      recommender = new VoteRecommender(undefined);
    });

    it("should report AI as disabled", () => {
      expect(recommender.isAiEnabled()).toBe(false);
    });

    it("should return VOTE_YES with HIGH confidence for very high YES odds (>=85%)", async () => {
      const highYesMarket = { ...sampleMarket, outcomePrices: [0.85, 0.15] };
      const result = await recommender.getRecommendation(highYesMarket);

      expect(result.recommendation).toBe("VOTE_YES");
      expect(result.confidence).toBe("HIGH");
      expect(result.formatted).toContain("Vote YES");
      expect(result.formatted).toContain("High confidence");
    });

    it("should return VOTE_YES with MEDIUM confidence for moderate YES odds (70-84%)", async () => {
      const moderateYesMarket = { ...sampleMarket, outcomePrices: [0.72, 0.28] };
      const result = await recommender.getRecommendation(moderateYesMarket);

      expect(result.recommendation).toBe("VOTE_YES");
      expect(result.confidence).toBe("MEDIUM");
      expect(result.formatted).toContain("Vote YES");
      expect(result.formatted).toContain("Medium confidence");
    });

    it("should return VOTE_NO with HIGH confidence for very high NO odds (>=85%)", async () => {
      const highNoMarket = { ...sampleMarket, outcomePrices: [0.10, 0.90] };
      const result = await recommender.getRecommendation(highNoMarket);

      expect(result.recommendation).toBe("VOTE_NO");
      expect(result.confidence).toBe("HIGH");
      expect(result.formatted).toContain("Vote NO");
      expect(result.formatted).toContain("High confidence");
    });

    it("should return VOTE_NO with MEDIUM confidence for moderate NO odds (70-84%)", async () => {
      const moderateNoMarket = { ...sampleMarket, outcomePrices: [0.25, 0.75] };
      const result = await recommender.getRecommendation(moderateNoMarket);

      expect(result.recommendation).toBe("VOTE_NO");
      expect(result.confidence).toBe("MEDIUM");
      expect(result.formatted).toContain("Vote NO");
    });

    it("should return HOLD with LOW confidence for close odds (<70% on both sides)", async () => {
      const closeMarket = { ...sampleMarket, outcomePrices: [0.52, 0.48] };
      const result = await recommender.getRecommendation(closeMarket);

      expect(result.recommendation).toBe("HOLD");
      expect(result.confidence).toBe("LOW");
      expect(result.formatted).toContain("Hold/Skip");
      expect(result.formatted).toContain("Low confidence");
    });

    it("should return HOLD for exactly 50/50 odds", async () => {
      const evenMarket = { ...sampleMarket, outcomePrices: [0.50, 0.50] };
      const result = await recommender.getRecommendation(evenMarket);

      expect(result.recommendation).toBe("HOLD");
      expect(result.confidence).toBe("LOW");
    });

    it("should return HOLD for edge case near threshold (69%)", async () => {
      const borderlineMarket = { ...sampleMarket, outcomePrices: [0.69, 0.31] };
      const result = await recommender.getRecommendation(borderlineMarket);

      expect(result.recommendation).toBe("HOLD");
      expect(result.confidence).toBe("LOW");
    });

    it("should return VOTE_YES at exactly 70% threshold", async () => {
      const thresholdMarket = { ...sampleMarket, outcomePrices: [0.70, 0.30] };
      const result = await recommender.getRecommendation(thresholdMarket);

      expect(result.recommendation).toBe("VOTE_YES");
      expect(result.confidence).toBe("MEDIUM");
    });
  });

  describe("with REAL Gemini API (AI-powered mode)", () => {
    let recommender: VoteRecommender;
    const geminiApiKey = process.env.GEMINI_API_KEY;

    beforeAll(() => {
      if (!geminiApiKey) {
        console.warn("GEMINI_API_KEY not set - skipping AI tests");
        return;
      }
      recommender = new VoteRecommender(geminiApiKey);
    });

    it("should report AI as enabled when API key provided", () => {
      if (!geminiApiKey) return;
      expect(recommender.isAiEnabled()).toBe(true);
    });

    it("should return AI-powered recommendation for high YES odds market", async () => {
      if (!geminiApiKey) return;

      const highYesMarket: NormalizedMarket = {
        ...sampleMarket,
        question: "Will the sun rise tomorrow?",
        outcomePrices: [0.95, 0.05],
        volume: 5000000,
        liquidity: 2000000,
      };

      const result = await recommender.getRecommendation(highYesMarket);

      // AI should strongly recommend YES for near-certain event
      expect(result.recommendation).toBe("VOTE_YES");
      expect(result.confidence).toBe("HIGH");
      expect(result.reasoning).toBeTruthy();
      expect(result.reasoning.length).toBeGreaterThan(10);
      expect(result.formatted).toContain("Vote YES");
    }, 30000); // 30s timeout for real API call

    it("should return AI-powered recommendation for high NO odds market", async () => {
      if (!geminiApiKey) return;

      const highNoMarket: NormalizedMarket = {
        ...sampleMarket,
        question: "Will humans land on Mars by December 2024?",
        outcomePrices: [0.02, 0.98],
        volume: 3000000,
        liquidity: 1500000,
        endDate: new Date("2024-12-31"),
      };

      const result = await recommender.getRecommendation(highNoMarket);

      // AI should strongly recommend NO for impossible event
      expect(result.recommendation).toBe("VOTE_NO");
      expect(result.confidence).toBe("HIGH");
      expect(result.reasoning).toBeTruthy();
      expect(result.formatted).toContain("Vote NO");
    }, 30000);

    it("should return HOLD for uncertain 50/50 market", async () => {
      if (!geminiApiKey) return;

      const uncertainMarket: NormalizedMarket = {
        ...sampleMarket,
        question: "Will a coin flip land on heads?",
        outcomePrices: [0.50, 0.50],
        volume: 10000,
        liquidity: 5000,
      };

      const result = await recommender.getRecommendation(uncertainMarket);

      // AI should recommend HOLD for pure chance event
      expect(result.recommendation).toBe("HOLD");
      expect(result.reasoning).toBeTruthy();
    }, 30000);

    it("should include trade data in analysis when provided", async () => {
      if (!geminiApiKey) return;

      const marketWithTrades: NormalizedMarket = {
        ...sampleMarket,
        outcomePrices: [0.75, 0.25],
        volume: 2000000,
      };

      const largeTrades: NormalizedTrade[] = [
        {
          id: "whale-1",
          marketId: "market-1",
          tokenId: "token-yes",
          side: "BUY",
          size: 500000,
          price: 0.75,
          timestamp: new Date(),
          outcome: "Yes",
          traderAddress: "0xwhale",
        },
      ];

      const result = await recommender.getRecommendation(marketWithTrades, largeTrades);

      // Should get a valid recommendation considering trade data
      expect(["VOTE_YES", "VOTE_NO", "HOLD"]).toContain(result.recommendation);
      expect(["HIGH", "MEDIUM", "LOW"]).toContain(result.confidence);
      expect(result.reasoning).toBeTruthy();
      expect(result.formatted).toBeTruthy();
    }, 30000);

    it("should handle API errors gracefully and fall back to basic recommendation", async () => {
      // Use invalid API key to trigger error
      const badRecommender = new VoteRecommender("invalid-api-key-12345");
      const highYesMarket = { ...sampleMarket, outcomePrices: [0.85, 0.15] };

      const result = await badRecommender.getRecommendation(highYesMarket);

      // Should fall back to basic recommendation
      expect(result.recommendation).toBe("VOTE_YES");
      expect(result.confidence).toBe("HIGH");
    }, 30000);
  });
});
