import { describe, expect, it } from "vitest";
import { gammaEventSchema, type NormalizedMarket, type NormalizedTrade } from "../api/types.js";
import {
  buildMarketDeadlineClock,
  findTopicRelevantFamilies,
  hasMinimumWhaleTrade,
  shouldDeliverAnalystAlert,
  WHALE_THRESHOLD_USD,
} from "./index.js";

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
  it("requires a whale bet of at least $10,000", () => {
    const belowThreshold = [createTrade("trade-1", 9999, 1)];
    const atThreshold = [createTrade("trade-2", 10000, 1)];

    expect(hasMinimumWhaleTrade(belowThreshold, WHALE_THRESHOLD_USD)).toBe(false);
    expect(hasMinimumWhaleTrade(atThreshold, WHALE_THRESHOLD_USD)).toBe(true);
  });

  it("does not treat empty trades as a valid whale signal", () => {
    expect(hasMinimumWhaleTrade([], WHALE_THRESHOLD_USD)).toBe(false);
  });

  it("selects grouped surveillance families that match configured topic keywords", () => {
    const events = [
      gammaEventSchema.parse({
        id: "event-1",
        title: "US x Iran ceasefire by...?",
        slug: "us-x-iran-ceasefire-by",
        endDate: null,
        showAllOutcomes: true,
        markets: [
          {
            id: "market-1",
            question: "US x Iran ceasefire by March 31?",
            conditionId: "cond-1",
            slug: "us-x-iran-ceasefire-by-march-31",
            endDate: null,
            groupItemTitle: "March 31",
            groupItemThreshold: "3",
            liquidity: "120000",
            volume: "600000",
            active: true,
            closed: false,
            outcomes: "[\"Yes\", \"No\"]",
            outcomePrices: "[\"0.23\", \"0.77\"]",
            clobTokenIds: "[\"yes-token\", \"no-token\"]",
          },
        ],
      }),
      gammaEventSchema.parse({
        id: "event-2",
        title: "NBA Finals Winner 2026",
        slug: "nba-finals-winner-2026",
        endDate: "2026-06-30T00:00:00Z",
        showAllOutcomes: true,
        markets: [
          {
            id: "market-2",
            question: "Will the Celtics win the 2026 NBA Finals?",
            conditionId: "cond-2",
            slug: "will-the-celtics-win-the-2026-nba-finals",
            endDate: "2026-06-30T00:00:00Z",
            groupItemTitle: "Boston Celtics",
            groupItemThreshold: "1",
            liquidity: "100000",
            volume: "250000",
            active: true,
            closed: false,
            outcomes: "[\"Yes\", \"No\"]",
            outcomePrices: "[\"0.42\", \"0.58\"]",
            clobTokenIds: "[\"yes-token-2\", \"no-token-2\"]",
          },
        ],
      }),
    ];

    const relevant = findTopicRelevantFamilies(events, ["iran", "trump"]);

    expect(relevant).toHaveLength(1);
    expect(relevant[0]?.slug).toBe("us-x-iran-ceasefire-by");
    expect(relevant[0]?.classification).toBe("grouped_date_threshold");
  });

  it("derives a market_deadline clock from the earliest active child deadline", () => {
    const family = findTopicRelevantFamilies([
      gammaEventSchema.parse({
        id: "event-3",
        title: "Military action against Iran ends on...?",
        slug: "military-action-against-iran-ends-on",
        endDate: "2026-03-31T00:00:00Z",
        showAllOutcomes: true,
        markets: [
          {
            id: "market-3",
            question: "Military action against Iran ends on March 21, 2026?",
            conditionId: "cond-3",
            slug: "military-action-against-iran-ends-on-march-21-2026",
            endDate: "2026-03-21T00:00:00Z",
            groupItemTitle: "March 21",
            groupItemThreshold: "10",
            liquidity: "10000",
            volume: "3000",
            active: true,
            closed: false,
            outcomes: "[\"Yes\", \"No\"]",
            outcomePrices: "[\"0.01\", \"0.99\"]",
            clobTokenIds: "[\"yes-token\", \"no-token\"]",
          },
          {
            id: "market-4",
            question: "Military action against Iran ends on March 31, 2026?",
            conditionId: "cond-4",
            slug: "military-action-against-iran-ends-on-march-31-2026",
            endDate: "2026-03-31T00:00:00Z",
            groupItemTitle: "March 31",
            groupItemThreshold: "20",
            liquidity: "12000",
            volume: "37000",
            active: true,
            closed: false,
            outcomes: "[\"Yes\", \"No\"]",
            outcomePrices: "[\"0.03\", \"0.97\"]",
            clobTokenIds: "[\"yes-token-2\", \"no-token-2\"]",
          },
        ],
      }),
    ], ["iran"])[0]!;

    const clock = buildMarketDeadlineClock(family);

    expect(clock.source).toBe("market_deadline");
    expect(clock.occurredAt.toISOString()).toBe("2026-03-21T00:00:00.000Z");
  });

  it("only delivers analyst alerts for watchlist-or-higher verdicts", () => {
    expect(shouldDeliverAnalystAlert("benign")).toBe(false);
    expect(shouldDeliverAnalystAlert("watchlist")).toBe(true);
    expect(shouldDeliverAnalystAlert("suspicious")).toBe(true);
    expect(shouldDeliverAnalystAlert("escalated")).toBe(true);
  });
});
