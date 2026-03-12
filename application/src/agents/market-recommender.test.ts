import { describe, expect, it } from "vitest";
import {
  fallbackRecommendationFromSignals,
  MarketRecommender,
  summarizeMarketSignals,
  type MarketSignalSummary,
} from "./market-recommender.js";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";

const sampleMarket: NormalizedMarket = {
  id: "market-1",
  question: "Will Bitcoin hit $100k by March 31?",
  slug: "bitcoin-100k-march",
  outcomes: ["Yes", "No"],
  outcomePrices: [0.72, 0.28],
  volume: 900000,
  liquidity: 250000,
  endDate: new Date(Date.now() + 30 * 60 * 1000),
  active: true,
  closed: false,
  tokenIds: ["yes-token", "no-token"],
};

function createTrade(
  id: string,
  outcome: "Yes" | "No",
  price: number,
  size: number,
  minutesAgo: number
): NormalizedTrade {
  return {
    id,
    marketId: sampleMarket.id,
    tokenId: outcome === "Yes" ? "yes-token" : "no-token",
    side: "BUY",
    size,
    price,
    timestamp: new Date(Date.now() - minutesAgo * 60 * 1000),
    outcome,
    traderAddress: null,
  };
}

describe("MarketRecommender helpers", () => {
  it("summarizes market signals from recent trades", () => {
    const trades = [
      createTrade("1", "Yes", 0.66, 80000, 20),
      createTrade("2", "Yes", 0.74, 60000, 5),
      createTrade("3", "No", 0.31, 15000, 10),
    ];

    const summary = summarizeMarketSignals(sampleMarket, trades);

    expect(summary.yesPrice).toBe(0.72);
    expect(summary.noPrice).toBe(0.28);
    expect(summary.yesRecentVolume).toBeGreaterThan(summary.noRecentVolume);
    expect(summary.yesMomentumDelta).toBeGreaterThan(0);
    expect(summary.largestRecentBets).toHaveLength(3);
  });

  it("falls back to HOLD when signals are weak", () => {
    const weakSignals: MarketSignalSummary = {
      yesPrice: 0.51,
      noPrice: 0.49,
      priceSpread: 0.02,
      minutesUntilClose: 45,
      recentVolume: 9000,
      recentLiquidityRatio: 0.01,
      yesRecentVolume: 4200,
      noRecentVolume: 4800,
      yesMomentumDelta: 0.01,
      noMomentumDelta: 0.0,
      largestRecentBets: [],
    };

    const recommendation = fallbackRecommendationFromSignals(sampleMarket, weakSignals);

    expect(recommendation.vote).toBe("HOLD");
    expect(recommendation.confidence).toBe("LOW");
  });

  it("leans toward the dominant side when price and volume are decisive", () => {
    const strongYesSignals: MarketSignalSummary = {
      yesPrice: 0.79,
      noPrice: 0.21,
      priceSpread: 0.58,
      minutesUntilClose: 20,
      recentVolume: 180000,
      recentLiquidityRatio: 0.72,
      yesRecentVolume: 150000,
      noRecentVolume: 10000,
      yesMomentumDelta: 0.08,
      noMomentumDelta: -0.03,
      largestRecentBets: [],
    };

    const recommendation = fallbackRecommendationFromSignals(sampleMarket, strongYesSignals);

    expect(recommendation.vote).toBe("YES");
    expect(recommendation.confidence).toBe("HIGH");
  });

  it("refuses to produce a binary recommendation for multi-outcome markets", async () => {
    const multiOutcomeMarket: NormalizedMarket = {
      ...sampleMarket,
      question: "US x Iran ceasefire by...?",
      outcomes: ["March 15", "March 31", "April 30"],
      outcomePrices: [0.02, 0.23, 0.47],
      tokenIds: ["march-15", "march-31", "april-30"],
    };
    const recommender = new MarketRecommender("test-key");

    const recommendation = await recommender.recommendVote(multiOutcomeMarket, []);

    expect(recommendation.vote).toBe("HOLD");
    expect(recommendation.confidence).toBe("LOW");
    expect(recommendation.reasoning).toContain("multiple outcome buckets");
  });
});
