import { describe, expect, it } from "vitest";
import {
  buildWalletClusters,
  scoreSuspiciousWalletActivity,
} from "./wallet-surveillance.js";

describe("buildWalletClusters", () => {
  it("clusters wallets that enter the same family in a tight window with similar size and direction", () => {
    const clusters = buildWalletClusters([
      {
        wallet: "0xaaa",
        firstSeenAt: new Date("2026-03-12T12:00:00Z"),
        familySlug: "us-x-iran-ceasefire-by",
        childSlug: "us-x-iran-ceasefire-by-march-31",
        enteredAt: new Date("2026-03-12T12:05:00Z"),
        direction: "YES",
        notionalUsd: 85000,
        priorCoAppearanceCount: 1,
      },
      {
        wallet: "0xbbb",
        firstSeenAt: new Date("2026-03-12T08:30:00Z"),
        familySlug: "us-x-iran-ceasefire-by",
        childSlug: "us-x-iran-ceasefire-by-march-31",
        enteredAt: new Date("2026-03-12T12:11:00Z"),
        direction: "YES",
        notionalUsd: 91000,
        priorCoAppearanceCount: 2,
      },
      {
        wallet: "0xccc",
        firstSeenAt: new Date("2026-03-05T08:30:00Z"),
        familySlug: "us-x-iran-ceasefire-by",
        childSlug: "us-x-iran-ceasefire-by-april-30",
        enteredAt: new Date("2026-03-12T12:40:00Z"),
        direction: "NO",
        notionalUsd: 20000,
        priorCoAppearanceCount: 0,
      },
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.wallets).toEqual(["0xaaa", "0xbbb"]);
    expect(clusters[0]?.reasons).toContain("same family entry window");
    expect(clusters[0]?.reasons).toContain("similar sizing pattern");
  });

  it("does not cluster wallets on opposite sides", () => {
    const clusters = buildWalletClusters([
      {
        wallet: "0xaaa",
        firstSeenAt: new Date("2026-03-12T12:00:00Z"),
        familySlug: "us-x-iran-ceasefire-by",
        childSlug: "us-x-iran-ceasefire-by-march-31",
        enteredAt: new Date("2026-03-12T12:05:00Z"),
        direction: "YES",
        notionalUsd: 85000,
        priorCoAppearanceCount: 0,
      },
      {
        wallet: "0xbbb",
        firstSeenAt: new Date("2026-03-12T08:30:00Z"),
        familySlug: "us-x-iran-ceasefire-by",
        childSlug: "us-x-iran-ceasefire-by-march-31",
        enteredAt: new Date("2026-03-12T12:11:00Z"),
        direction: "NO",
        notionalUsd: 91000,
        priorCoAppearanceCount: 0,
      },
    ]);

    expect(clusters).toEqual([]);
  });
});

describe("scoreSuspiciousWalletActivity", () => {
  it("scores a new wallet with large, clustered, short-lead activity as highly suspicious", () => {
    const result = scoreSuspiciousWalletActivity({
      wallet: "0xaaa",
      familySlug: "military-action-against-iran-ends-on",
      childSlug: "military-action-against-iran-ends-on-march-21-2026",
      firstSeenAt: new Date("2026-03-12T12:00:00Z"),
      tradePlacedAt: new Date("2026-03-12T12:04:00Z"),
      eventOccurredAt: new Date("2026-03-12T13:00:00Z"),
      timestampSource: "official_source",
      notionalUsd: 120000,
      recentVolume1hUsd: 150000,
      recentLiquidityUsd: 80000,
      openInterestUsd: 90000,
      clusterSize: 3,
      repeatedPreEventWins: 2,
      contractSpecificity: "exact_date",
      priorActivityCount: 0,
    });

    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.band).toBe("high");
    expect(result.reasons).toContain("new or low-history wallet");
    expect(result.reasons).toContain("large size relative to liquidity");
    expect(result.reasons).toContain("short lead time to catalyst");
    expect(result.reasons).toContain("clustered wallet entry");
  });

  it("scores an established wallet with small non-urgent activity as low risk", () => {
    const result = scoreSuspiciousWalletActivity({
      wallet: "0xddd",
      familySlug: "republican-presidential-nominee-2028",
      childSlug: "will-marco-rubio-win-the-2028-republican-presidential-nomination",
      firstSeenAt: new Date("2024-01-01T00:00:00Z"),
      tradePlacedAt: new Date("2026-03-12T12:04:00Z"),
      eventOccurredAt: new Date("2028-11-07T00:00:00Z"),
      timestampSource: "official_source",
      notionalUsd: 6000,
      recentVolume1hUsd: 900000,
      recentLiquidityUsd: 500000,
      openInterestUsd: 800000,
      clusterSize: 1,
      repeatedPreEventWins: 0,
      contractSpecificity: "candidate_field",
      priorActivityCount: 180,
    });

    expect(result.score).toBeLessThan(30);
    expect(result.band).toBe("low");
    expect(result.reasons).not.toContain("clustered wallet entry");
  });
});
