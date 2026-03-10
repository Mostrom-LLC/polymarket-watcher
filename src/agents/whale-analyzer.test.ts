import { describe, it, expect, beforeAll } from "vitest";
import { WhaleAnalyzer } from "./whale-analyzer.js";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";

/**
 * Integration tests for WhaleAnalyzer using REAL Gemini API
 * 
 * These tests call the actual Gemini API - no mocks allowed per TESTING.md
 * Uses GEMINI_API_KEY from environment
 */
describe("WhaleAnalyzer (Integration)", () => {
  let analyzer: WhaleAnalyzer;
  const apiKey = process.env.GEMINI_API_KEY;

  const sampleMarket: NormalizedMarket = {
    id: "market-bitcoin-100k",
    question: "Will Bitcoin hit $100k by end of 2024?",
    slug: "bitcoin-100k-2024",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.65, 0.35],
    volume: 1000000,
    liquidity: 500000,
    endDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
    active: true,
    closed: false,
    tokenIds: ["token-yes", "token-no"],
  };

  const sampleTrades: NormalizedTrade[] = [
    {
      id: "trade-1",
      marketId: "market-bitcoin-100k",
      tokenId: "token-yes",
      side: "BUY",
      size: 100000, // $100k position at $0.65 = $65k bet
      price: 0.65,
      timestamp: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
      outcome: "Yes",
      traderAddress: "0x1234567890abcdef",
    },
    {
      id: "trade-2",
      marketId: "market-bitcoin-100k",
      tokenId: "token-yes",
      side: "BUY",
      size: 80000, // $80k position at $0.65 = $52k bet
      price: 0.65,
      timestamp: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
      outcome: "Yes",
      traderAddress: "0xabcdef1234567890",
    },
    {
      id: "trade-3",
      marketId: "market-bitcoin-100k",
      tokenId: "token-no",
      side: "BUY",
      size: 50000, // $50k position at $0.35 = $17.5k bet
      price: 0.35,
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      outcome: "No",
      traderAddress: "0x9876543210fedcba",
    },
  ];

  beforeAll(() => {
    if (!apiKey) {
      console.warn("GEMINI_API_KEY not set - skipping integration tests");
    }
  });

  describe("analyzeTrades", () => {
    it("should analyze whale activity using real Gemini API", async () => {
      if (!apiKey) {
        console.log("Skipping: GEMINI_API_KEY not set");
        return;
      }

      analyzer = new WhaleAnalyzer(apiKey);
      const result = await analyzer.analyzeTrades(sampleMarket, sampleTrades);

      // Verify structure
      expect(result).toHaveProperty("hasWhaleActivity");
      expect(result).toHaveProperty("largestBets");
      expect(result).toHaveProperty("marketLean");
      expect(result).toHaveProperty("momentum");
      expect(result).toHaveProperty("recommendation");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("reasoning");

      // With $117k in YES bets vs $17.5k in NO bets, should detect whale activity
      expect(result.hasWhaleActivity).toBe(true);
      expect(result.largestBets.length).toBeGreaterThan(0);
      expect(["YES", "NO", "NEUTRAL"]).toContain(result.marketLean);
      expect(["LEAN_YES", "LEAN_NO", "HOLD"]).toContain(result.recommendation);
      expect(["HIGH", "MEDIUM", "LOW"]).toContain(result.confidence);
      expect(result.reasoning).toBeTruthy();
    });

    it("should return no whale activity for empty trades", async () => {
      if (!apiKey) {
        console.log("Skipping: GEMINI_API_KEY not set");
        return;
      }

      analyzer = new WhaleAnalyzer(apiKey);
      const result = await analyzer.analyzeTrades(sampleMarket, []);

      expect(result.hasWhaleActivity).toBe(false);
      expect(result.largestBets).toHaveLength(0);
      expect(result.marketLean).toBe("NEUTRAL");
      expect(result.recommendation).toBe("HOLD");
      expect(result.confidence).toBe("LOW");
    });

    it("should detect market lean towards YES with large YES bets", async () => {
      if (!apiKey) {
        console.log("Skipping: GEMINI_API_KEY not set");
        return;
      }

      // All large bets on YES
      const yesTrades: NormalizedTrade[] = [
        {
          id: "trade-big-yes-1",
          marketId: "market-bitcoin-100k",
          tokenId: "token-yes",
          side: "BUY",
          size: 200000,
          price: 0.65,
          timestamp: new Date(Date.now() - 10 * 60 * 1000),
          outcome: "Yes",
          traderAddress: "0x1111",
        },
        {
          id: "trade-big-yes-2",
          marketId: "market-bitcoin-100k",
          tokenId: "token-yes",
          side: "BUY",
          size: 150000,
          price: 0.65,
          timestamp: new Date(Date.now() - 20 * 60 * 1000),
          outcome: "Yes",
          traderAddress: "0x2222",
        },
      ];

      analyzer = new WhaleAnalyzer(apiKey);
      const result = await analyzer.analyzeTrades(sampleMarket, yesTrades);

      // Should lean YES with high whale activity
      expect(result.hasWhaleActivity).toBe(true);
      // Market lean could be YES or NEUTRAL depending on AI analysis
      expect(["YES", "NEUTRAL"]).toContain(result.marketLean);
    });
  });

  describe("fallback behavior", () => {
    it("should provide fallback analysis based on trade data when API fails", async () => {
      // Use invalid API key to trigger fallback
      analyzer = new WhaleAnalyzer("invalid-api-key");
      
      const result = await analyzer.analyzeTrades(sampleMarket, sampleTrades);

      // Should still return valid structure with fallback data
      expect(result).toHaveProperty("hasWhaleActivity");
      expect(result).toHaveProperty("largestBets");
      expect(result.largestBets.length).toBeGreaterThan(0);
      expect(result.confidence).toBe("LOW");
      expect(result.reasoning).toContain("fallback");
    });
  });
});
