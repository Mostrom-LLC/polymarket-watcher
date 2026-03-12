import { describe, expect, it } from "vitest";
import { runSurveillancePipeline } from "./surveillance-pipeline.js";

describe("runSurveillancePipeline", () => {
  it("turns a family spike and clustered wallet entries into an escalated analyst alert", () => {
    const result = runSurveillancePipeline({
      family: {
        eventId: "event-1",
        slug: "military-action-against-iran-ends-on",
        title: "Military action against Iran ends on...?",
        eventEndDate: new Date("2026-03-31T00:00:00Z"),
        showAllOutcomes: true,
        classification: "grouped_exact_date",
        childMarkets: [
          {
            id: "child-1",
            slug: "military-action-against-iran-ends-on-march-21-2026",
            question: "Military action against Iran ends on March 21, 2026?",
            endDate: new Date("2026-03-21T00:00:00Z"),
            groupItemTitle: "March 21",
            groupItemThreshold: 21,
            outcomes: ["Yes", "No"],
            outcomePrices: [0.17, 0.83],
            tokenIds: ["token-21-yes", "token-21-no"],
            active: true,
            closed: false,
            liquidity: 80000,
            volume: 260000,
          },
          {
            id: "child-2",
            slug: "military-action-against-iran-ends-on-march-22-2026",
            question: "Military action against Iran ends on March 22, 2026?",
            endDate: new Date("2026-03-22T00:00:00Z"),
            groupItemTitle: "March 22",
            groupItemThreshold: 22,
            outcomes: ["Yes", "No"],
            outcomePrices: [0.16, 0.84],
            tokenIds: ["token-22-yes", "token-22-no"],
            active: true,
            closed: false,
            liquidity: 82000,
            volume: 240000,
          },
        ],
      },
      childSnapshots: [
        {
          slug: "military-action-against-iran-ends-on-march-21-2026",
          label: "March 21",
          thresholdIndex: 21,
          currentPrice: 0.17,
          priceChange5m: 0.1,
          priceChange1h: 0.14,
          volume1h: 65000,
          volume24h: 240000,
          liquidity: 80000,
          openInterest: 110000,
        },
        {
          slug: "military-action-against-iran-ends-on-march-22-2026",
          label: "March 22",
          thresholdIndex: 22,
          currentPrice: 0.16,
          priceChange5m: 0.09,
          priceChange1h: 0.13,
          volume1h: 60000,
          volume24h: 220000,
          liquidity: 82000,
          openInterest: 108000,
        },
      ],
      walletEntries: [
        {
          wallet: "0xaaa",
          firstSeenAt: new Date("2026-03-12T11:50:00Z"),
          familySlug: "military-action-against-iran-ends-on",
          childSlug: "military-action-against-iran-ends-on-march-21-2026",
          enteredAt: new Date("2026-03-12T12:01:00Z"),
          direction: "YES",
          notionalUsd: 110000,
          priorCoAppearanceCount: 1,
        },
        {
          wallet: "0xbbb",
          firstSeenAt: new Date("2026-03-12T07:10:00Z"),
          familySlug: "military-action-against-iran-ends-on",
          childSlug: "military-action-against-iran-ends-on-march-22-2026",
          enteredAt: new Date("2026-03-12T12:08:00Z"),
          direction: "YES",
          notionalUsd: 96000,
          priorCoAppearanceCount: 2,
        },
      ],
      walletInputs: [
        {
          wallet: "0xaaa",
          familySlug: "military-action-against-iran-ends-on",
          childSlug: "military-action-against-iran-ends-on-march-21-2026",
          firstSeenAt: new Date("2026-03-12T11:50:00Z"),
          tradePlacedAt: new Date("2026-03-12T12:01:00Z"),
          eventOccurredAt: new Date("2026-03-12T13:00:00Z"),
          timestampSource: "official_source",
          notionalUsd: 110000,
          recentVolume1hUsd: 140000,
          recentLiquidityUsd: 80000,
          openInterestUsd: 110000,
          clusterSize: 2,
          repeatedPreEventWins: 2,
          contractSpecificity: "exact_date",
          priorActivityCount: 0,
          tradeDirection: "YES",
          tradePrice: 0.31,
          largestTradeUsd: 110000,
          walletAgeMinutes: 11,
        },
        {
          wallet: "0xbbb",
          familySlug: "military-action-against-iran-ends-on",
          childSlug: "military-action-against-iran-ends-on-march-22-2026",
          firstSeenAt: new Date("2026-03-12T07:10:00Z"),
          tradePlacedAt: new Date("2026-03-12T12:08:00Z"),
          eventOccurredAt: new Date("2026-03-12T13:00:00Z"),
          timestampSource: "official_source",
          notionalUsd: 96000,
          recentVolume1hUsd: 130000,
          recentLiquidityUsd: 82000,
          openInterestUsd: 108000,
          clusterSize: 2,
          repeatedPreEventWins: 1,
          contractSpecificity: "exact_date",
          priorActivityCount: 1,
          tradeDirection: "YES",
          tradePrice: 0.29,
          largestTradeUsd: 96000,
          walletAgeMinutes: 298,
        },
      ],
      eventClock: {
        occurredAt: new Date("2026-03-12T13:00:00Z"),
        source: "official_source",
        publishedAt: null,
      },
      generatedAt: new Date("2026-03-12T12:12:00Z"),
    });

    expect(result.anomaly.pattern).toBe("adjacent_bucket_spike");
    expect(result.clusters).toHaveLength(1);
    expect(result.walletFindings[0]?.band).toBe("high");
    expect(result.alert.verdict).toBe("escalated");
    expect(result.alert.direction).toBe("Heavy YES buying");
    expect(result.alert.largestTrade.notionalUsd).toBe(110000);
    expect(result.alert.marketLabel).toContain("March 21");
    expect(result.alert.recommendation).toBe("Lean YES");
  });
});
