import { describe, expect, it } from "vitest";
import { closesWithinHours, hasMinimumWhaleTrade, MARKET_CLOSE_WINDOW_HOURS, WHALE_THRESHOLD_USD } from "./index.js";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";

const sampleMarket: NormalizedMarket = {
  id: "market-1",
  question: "Will BTC hit $100k?",
  slug: "btc-100k",
  outcomes: ["Yes", "No"],
  outcomePrices: [0.62, 0.38],
  volume: 1000000,
  liquidity: 500000,
  endDate: new Date(Date.now() + 12 * 60 * 60 * 1000),
  active: true,
  closed: false,
  tokenIds: ["yes-token", "no-token"],
};

function createTrade(id: string, size: number, price: number): NormalizedTrade {
  return {
    id,
    marketId: sampleMarket.id,
    tokenId: "yes-token",
    side: "BUY",
    size,
    price,
    timestamp: new Date(),
    outcome: "Yes",
    traderAddress: null,
  };
}

describe("workflow signal guards", () => {
  it("treats markets closing within 48 hours as eligible", () => {
    expect(closesWithinHours(sampleMarket, MARKET_CLOSE_WINDOW_HOURS)).toBe(true);
    expect(closesWithinHours(sampleMarket, 6)).toBe(false);
  });

  it("rejects markets closing after the 48 hour window", () => {
    const slowMarket: NormalizedMarket = {
      ...sampleMarket,
      endDate: new Date(Date.now() + (MARKET_CLOSE_WINDOW_HOURS + 1) * 60 * 60 * 1000),
    };

    expect(closesWithinHours(slowMarket, MARKET_CLOSE_WINDOW_HOURS)).toBe(false);
  });

  it("requires a whale bet of at least $10,000", () => {
    const belowThreshold = [createTrade("trade-1", 9999, 1)];
    const atThreshold = [createTrade("trade-2", 10000, 1)];

    expect(hasMinimumWhaleTrade(belowThreshold, WHALE_THRESHOLD_USD)).toBe(false);
    expect(hasMinimumWhaleTrade(atThreshold, WHALE_THRESHOLD_USD)).toBe(true);
  });

  it("does not treat empty trades as a valid whale signal", () => {
    expect(hasMinimumWhaleTrade([], WHALE_THRESHOLD_USD)).toBe(false);
  });
});
