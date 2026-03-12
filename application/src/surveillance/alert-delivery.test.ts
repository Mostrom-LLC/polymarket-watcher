import { describe, expect, it, vi } from "vitest";
import { deliverAnalystAlert } from "./alert-delivery.js";
import type { AnalystAlert } from "./alert-pipeline.js";

function createAlert(verdict: AnalystAlert["verdict"]): AnalystAlert {
  return {
    fingerprint: "military-action-against-iran-ends-on:adjacent_bucket_spike:march-21,march-22",
    verdict,
    summary: "Military action against Iran ends on...?: adjacent_bucket_spike impacting 2 contracts",
    familySlug: "military-action-against-iran-ends-on",
    familyTitle: "Military action against Iran ends on...?",
    classification: "grouped_exact_date",
    anomalyPattern: "adjacent_bucket_spike",
    anomalySeverity: "high",
    marketLabel: "Military action against Iran ends on Mar 21",
    direction: "Heavy YES buying",
    priceMove: {
      fromPrice: 0.28,
      toPrice: 0.39,
      deltaPoints: 0.11,
    },
    largestTrade: {
      wallet: "0xaaa",
      childSlug: "military-action-against-iran-ends-on-march-21-2026",
      notionalUsd: 48000,
      direction: "YES",
      price: 0.31,
      walletAgeMinutes: 120,
    },
    recommendation: "Lean YES",
    topWallets: [
      {
        wallet: "0xaaa",
        childSlug: "military-action-against-iran-ends-on-march-21-2026",
        score: 92,
        band: "high",
        reasons: ["new or low-history wallet"],
        priorActivityCount: 0,
        repeatedPreEventWins: 2,
        realizedPnlUsd: 180000,
        currentExposureUsd: 120000,
        tradeDirection: "YES",
        tradePrice: 0.31,
        largestTradeUsd: 48000,
        walletAgeMinutes: 120,
      },
    ],
    clusterCount: 1,
    evidence: ["timestamp source: official_source", "adjacent thresholds moved together"],
    generatedAt: new Date("2026-03-12T12:20:00Z"),
  };
}

describe("deliverAnalystAlert", () => {
  it("sends a new analyst alert and returns an updated replay snapshot", async () => {
    const sendAnalystAlert = vi.fn().mockResolvedValue({ ok: true });

    const result = await deliverAnalystAlert({
      alert: createAlert("watchlist"),
      notifier: { sendAnalystAlert },
      cooldownMs: 6 * 60 * 60 * 1000,
      snapshot: { entries: [] },
    });

    expect(result.sent).toBe(true);
    expect(result.decision.reason).toBe("new_alert");
    expect(sendAnalystAlert).toHaveBeenCalledTimes(1);
    expect(result.snapshot.entries).toHaveLength(1);
  });

  it("suppresses duplicate delivery while cooldown is active", async () => {
    const sendAnalystAlert = vi.fn().mockResolvedValue({ ok: true });

    const first = await deliverAnalystAlert({
      alert: createAlert("watchlist"),
      notifier: { sendAnalystAlert },
      cooldownMs: 6 * 60 * 60 * 1000,
      snapshot: { entries: [] },
    });

    const duplicate = await deliverAnalystAlert({
      alert: {
        ...createAlert("watchlist"),
        generatedAt: new Date("2026-03-12T13:00:00Z"),
      },
      notifier: { sendAnalystAlert },
      cooldownMs: 6 * 60 * 60 * 1000,
      snapshot: first.snapshot,
    });

    expect(duplicate.sent).toBe(false);
    expect(duplicate.decision.reason).toBe("cooldown_active");
    expect(sendAnalystAlert).toHaveBeenCalledTimes(1);
  });

  it("delivers severity escalations even during cooldown", async () => {
    const sendAnalystAlert = vi.fn().mockResolvedValue({ ok: true });

    const first = await deliverAnalystAlert({
      alert: createAlert("watchlist"),
      notifier: { sendAnalystAlert },
      cooldownMs: 6 * 60 * 60 * 1000,
      snapshot: { entries: [] },
    });

    const escalated = await deliverAnalystAlert({
      alert: {
        ...createAlert("escalated"),
        generatedAt: new Date("2026-03-12T12:30:00Z"),
      },
      notifier: { sendAnalystAlert },
      cooldownMs: 6 * 60 * 60 * 1000,
      snapshot: first.snapshot,
    });

    expect(escalated.sent).toBe(true);
    expect(escalated.decision.reason).toBe("severity_escalation");
    expect(sendAnalystAlert).toHaveBeenCalledTimes(2);
  });
});
