import { describe, expect, it } from "vitest";
import { classifyMarket } from "./topic-classifier.js";
import { analyzeWhaleTrades } from "./whale-analyzer.js";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";

const geminiApiKey = process.env.GEMINI_API_KEY;

const sampleMarket: NormalizedMarket = {
  id: "market-btc-1",
  question: "Will Bitcoin trade above $100,000 by December 31, 2026?",
  slug: "bitcoin-100k-2026",
  outcomes: ["Yes", "No"],
  outcomePrices: [0.62, 0.38],
  volume: 2500000,
  liquidity: 800000,
  endDate: new Date("2026-12-31T23:59:59.000Z"),
  active: true,
  closed: false,
  tokenIds: ["btc-yes", "btc-no"],
};

const sampleTrades: NormalizedTrade[] = [
  {
    id: "trade-1",
    marketId: sampleMarket.id,
    tokenId: "btc-yes",
    side: "BUY",
    size: 180000,
    price: 0.64,
    timestamp: new Date(Date.now() - 15 * 60 * 1000),
    outcome: "Yes",
    traderAddress: null,
  },
  {
    id: "trade-2",
    marketId: sampleMarket.id,
    tokenId: "btc-yes",
    side: "BUY",
    size: 120000,
    price: 0.61,
    timestamp: new Date(Date.now() - 10 * 60 * 1000),
    outcome: "Yes",
    traderAddress: null,
  },
  {
    id: "trade-3",
    marketId: sampleMarket.id,
    tokenId: "btc-no",
    side: "BUY",
    size: 50000,
    price: 0.39,
    timestamp: new Date(Date.now() - 5 * 60 * 1000),
    outcome: "No",
    traderAddress: null,
  },
];

describe.skipIf(!geminiApiKey)("Gemini integration", () => {
  it("classifies a market with a real Gemini API call", async () => {
    const result = await classifyMarket(sampleMarket, ["bitcoin", "crypto"], {
      apiKey: geminiApiKey!,
      cacheTtlMs: 0,
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    });

    expect(result.market.id).toBe(sampleMarket.id);
    expect(result.isRelevant).toBe(true);
    expect(result.relevanceScore).toBeGreaterThanOrEqual(50);
    expect(result.reasoning.length).toBeGreaterThan(0);
  }, 30000);

  it("analyzes whale trades with a real Gemini API call", async () => {
    const result = await analyzeWhaleTrades(sampleMarket, sampleTrades, {
      apiKey: geminiApiKey!,
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    });

    expect(result.largestBets).toHaveLength(3);
    expect(result.hasWhaleActivity).toBe(true);
    expect(result.reasoning).not.toBe("Analysis failed, using trade data fallback");
  }, 30000);
});
