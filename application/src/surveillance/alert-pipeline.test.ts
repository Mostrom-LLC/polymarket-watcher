import { describe, expect, it } from "vitest";
import { buildAnalystAlert } from "./alert-pipeline.js";

describe("buildAnalystAlert", () => {
  it("escalates a high-severity family anomaly with clustered high-risk wallets", () => {
    const alert = buildAnalystAlert({
      family: {
        slug: "military-action-against-iran-ends-on",
        title: "Military action against Iran ends on...?",
        classification: "grouped_exact_date",
        childMarkets: [
          {
            id: "child-1",
            slug: "military-action-against-iran-ends-on-march-21-2026",
            question: "Military action against Iran ends on Mar 21?",
            endDate: new Date("2026-03-21T00:00:00Z"),
            groupItemTitle: "Mar 21",
            groupItemThreshold: 21,
            outcomes: ["Yes", "No"],
            outcomePrices: [0.39, 0.61],
            tokenIds: ["yes-token", "no-token"],
            active: true,
            closed: false,
            liquidity: 80000,
            volume: 250000,
          },
        ],
      },
      anomaly: {
        pattern: "adjacent_bucket_spike",
        severity: "high",
        impactedChildren: [
          "military-action-against-iran-ends-on-march-21-2026",
          "military-action-against-iran-ends-on-march-22-2026",
        ],
        reasons: ["adjacent thresholds moved together"],
      },
      eventClock: {
        occurredAt: new Date("2026-03-12T13:00:00Z"),
        source: "official_source",
        publishedAt: null,
      },
      walletFindings: [
        {
          wallet: "0xaaa",
          childSlug: "military-action-against-iran-ends-on-march-21-2026",
          score: 92,
          band: "high",
          reasons: ["new or low-history wallet", "short lead time to catalyst"],
          priorActivityCount: 0,
          repeatedPreEventWins: 2,
          realizedPnlUsd: 180000,
          currentExposureUsd: 120000,
          tradeDirection: "YES",
          tradePrice: 0.31,
          largestTradeUsd: 48000,
          walletAgeMinutes: 120,
        },
        {
          wallet: "0xbbb",
          childSlug: "military-action-against-iran-ends-on-march-22-2026",
          score: 84,
          band: "high",
          reasons: ["clustered wallet entry", "large size relative to liquidity"],
          priorActivityCount: 1,
          repeatedPreEventWins: 1,
          realizedPnlUsd: 0,
          currentExposureUsd: 95000,
          tradeDirection: "YES",
          tradePrice: 0.29,
          largestTradeUsd: 36000,
          walletAgeMinutes: 180,
        },
      ],
      childSnapshots: [
        {
          slug: "military-action-against-iran-ends-on-march-21-2026",
          label: "Mar 21",
          thresholdIndex: 21,
          currentPrice: 0.39,
          priceChange5m: 0.05,
          priceChange1h: 0.11,
          volume1h: 65000,
          volume24h: 240000,
          liquidity: 80000,
          openInterest: 110000,
        },
      ],
      clusters: [
        {
          familySlug: "military-action-against-iran-ends-on",
          wallets: ["0xaaa", "0xbbb"],
          reasons: ["same family entry window", "similar sizing pattern"],
        },
      ],
      generatedAt: new Date("2026-03-12T12:20:00Z"),
    });

    expect(alert.verdict).toBe("escalated");
    expect(alert.fingerprint).toContain("military-action-against-iran-ends-on");
    expect(alert.topWallets.map((wallet) => wallet.wallet)).toEqual(["0xaaa", "0xbbb"]);
    expect(alert.evidence).toContain("timestamp source: official_source");
    expect(alert.evidence).toContain("adjacent thresholds moved together");
    expect(alert.clusterCount).toBe(1);
    expect(alert.marketLabel).toBe("Military action against Iran ends on Mar 21");
    expect(alert.direction).toBe("Heavy YES buying");
    expect(alert.priceMove.fromPrice).toBeCloseTo(0.28, 2);
    expect(alert.priceMove.toPrice).toBeCloseTo(0.39, 2);
    expect(alert.largestTrade.notionalUsd).toBe(48000);
    expect(alert.largestTrade.price).toBeCloseTo(0.31, 2);
    expect(alert.largestTrade.walletAgeMinutes).toBe(120);
    expect(alert.recommendation).toBe("Lean YES");
  });

  it("downgrades ordinary activity into a watchlist alert instead of escalating", () => {
    const alert = buildAnalystAlert({
      family: {
        slug: "republican-presidential-nominee-2028",
        title: "Republican Presidential Nominee 2028",
        classification: "candidate_field",
        childMarkets: [
          {
            id: "child-2",
            slug: "will-marco-rubio-win-the-2028-republican-presidential-nomination",
            question: "Will Marco Rubio win the 2028 Republican presidential nomination?",
            endDate: new Date("2028-11-07T00:00:00Z"),
            groupItemTitle: "Marco Rubio",
            groupItemThreshold: 2,
            outcomes: ["Yes", "No"],
            outcomePrices: [0.32, 0.68],
            tokenIds: ["yes-token", "no-token"],
            active: true,
            closed: false,
            liquidity: 120000,
            volume: 350000,
          },
        ],
      },
      anomaly: {
        pattern: "rotation",
        severity: "medium",
        impactedChildren: [
          "will-jd-vance-win-the-2028-republican-presidential-nomination",
          "will-marco-rubio-win-the-2028-republican-presidential-nomination",
        ],
        reasons: ["capital rotated between sibling contracts"],
      },
      eventClock: {
        occurredAt: new Date("2028-11-07T00:00:00Z"),
        source: "trusted_news",
        publishedAt: new Date("2026-03-12T12:00:00Z"),
      },
      walletFindings: [
        {
          wallet: "0xccc",
          childSlug: "will-marco-rubio-win-the-2028-republican-presidential-nomination",
          score: 58,
          band: "medium",
          reasons: ["large size relative to recent volume"],
          priorActivityCount: 7,
          repeatedPreEventWins: 0,
          realizedPnlUsd: 12000,
          currentExposureUsd: 26000,
          tradeDirection: "NO",
          tradePrice: 0.71,
          largestTradeUsd: 26000,
          walletAgeMinutes: 720,
        },
      ],
      childSnapshots: [
        {
          slug: "will-marco-rubio-win-the-2028-republican-presidential-nomination",
          label: "Marco Rubio",
          thresholdIndex: 2,
          currentPrice: 0.32,
          priceChange5m: -0.01,
          priceChange1h: -0.03,
          volume1h: 18000,
          volume24h: 220000,
          liquidity: 120000,
          openInterest: 180000,
        },
      ],
      clusters: [],
      generatedAt: new Date("2026-03-12T12:20:00Z"),
    });

    expect(alert.verdict).toBe("watchlist");
    expect(alert.evidence).toContain("timestamp source: trusted_news");
    expect(alert.summary).toContain("rotation");
    expect(alert.topWallets[0]?.wallet).toBe("0xccc");
    expect(alert.direction).toBe("Heavy NO buying");
    expect(alert.recommendation).toBe("Lean NO");
  });
});
