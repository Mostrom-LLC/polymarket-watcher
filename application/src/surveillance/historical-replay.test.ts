import { describe, expect, it, vi } from "vitest";
import { runHistoricalReplay } from "./historical-replay.js";
import type { SurveillancePipelineInput } from "./surveillance-pipeline.js";

function createReplayFrame(overrides: Partial<SurveillancePipelineInput> = {}): SurveillancePipelineInput {
  return {
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
      },
    ],
    eventClock: {
      occurredAt: new Date("2026-03-12T13:00:00Z"),
      source: "official_source",
      publishedAt: null,
    },
    generatedAt: new Date("2026-03-12T12:12:00Z"),
    ...overrides,
  };
}

describe("runHistoricalReplay", () => {
  it("suppresses duplicate alerts across replay frames", async () => {
    const sendAnalystAlert = vi.fn().mockResolvedValue({ ok: true });

    const result = await runHistoricalReplay({
      frames: [
        createReplayFrame(),
        createReplayFrame({
          generatedAt: new Date("2026-03-12T13:12:00Z"),
        }),
      ],
      notifier: { sendAnalystAlert },
      cooldownMs: 6 * 60 * 60 * 1000,
    });

    expect(result.deliveredAlerts).toHaveLength(1);
    expect(result.suppressedAlerts).toBe(1);
    expect(sendAnalystAlert).toHaveBeenCalledTimes(1);
  });

  it("delivers a replay alert when the verdict escalates in a later frame", async () => {
    const sendAnalystAlert = vi.fn().mockResolvedValue({ ok: true });

    const result = await runHistoricalReplay({
      frames: [
        createReplayFrame({
          childSnapshots: [
            {
              slug: "military-action-against-iran-ends-on-march-21-2026",
              label: "March 21",
              thresholdIndex: 21,
              currentPrice: 0.17,
              priceChange5m: 0.09,
              priceChange1h: 0.13,
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
              priceChange5m: 0.02,
              priceChange1h: 0.03,
              volume1h: 12000,
              volume24h: 220000,
              liquidity: 82000,
              openInterest: 108000,
            },
          ],
          walletInputs: [
            {
              ...createReplayFrame().walletInputs[0]!,
              clusterSize: 1,
            },
          ],
          walletEntries: [createReplayFrame().walletEntries[0]!],
        }),
        createReplayFrame({
          generatedAt: new Date("2026-03-12T12:30:00Z"),
        }),
      ],
      notifier: { sendAnalystAlert },
      cooldownMs: 6 * 60 * 60 * 1000,
    });

    expect(result.deliveredAlerts).toHaveLength(2);
    expect(result.deliveredAlerts[0]?.verdict).toBe("suspicious");
    expect(result.deliveredAlerts[1]?.verdict).toBe("escalated");
    expect(sendAnalystAlert).toHaveBeenCalledTimes(2);
  });
});
