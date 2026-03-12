import { describe, expect, it } from "vitest";
import { ReplayLedger } from "./replay-ledger.js";

describe("ReplayLedger", () => {
  it("suppresses duplicate alerts inside the cooldown window", () => {
    const ledger = new ReplayLedger({ cooldownMs: 6 * 60 * 60 * 1000 });

    const first = ledger.record({
      fingerprint: "military-action-against-iran-ends-on:adjacent_bucket_spike",
      verdict: "watchlist",
      observedAt: new Date("2026-03-12T12:00:00Z"),
    });
    const duplicate = ledger.record({
      fingerprint: "military-action-against-iran-ends-on:adjacent_bucket_spike",
      verdict: "watchlist",
      observedAt: new Date("2026-03-12T13:00:00Z"),
    });

    expect(first.emit).toBe(true);
    expect(first.reason).toBe("new_alert");
    expect(duplicate.emit).toBe(false);
    expect(duplicate.reason).toBe("cooldown_active");
  });

  it("allows escalation even when a prior lower-severity alert is still cooling down", () => {
    const ledger = new ReplayLedger({ cooldownMs: 6 * 60 * 60 * 1000 });

    ledger.record({
      fingerprint: "us-x-iran-ceasefire-by:one_child_spike",
      verdict: "watchlist",
      observedAt: new Date("2026-03-12T12:00:00Z"),
    });

    const escalated = ledger.record({
      fingerprint: "us-x-iran-ceasefire-by:one_child_spike",
      verdict: "escalated",
      observedAt: new Date("2026-03-12T12:10:00Z"),
    });

    expect(escalated.emit).toBe(true);
    expect(escalated.reason).toBe("severity_escalation");
  });

  it("preserves duplicate suppression across restart via snapshot restore", () => {
    const original = new ReplayLedger({ cooldownMs: 6 * 60 * 60 * 1000 });

    original.record({
      fingerprint: "republican-presidential-nominee-2028:rotation",
      verdict: "suspicious",
      observedAt: new Date("2026-03-12T12:00:00Z"),
    });

    const restored = ReplayLedger.fromSnapshot(original.snapshot(), {
      cooldownMs: 6 * 60 * 60 * 1000,
    });

    const duplicate = restored.record({
      fingerprint: "republican-presidential-nominee-2028:rotation",
      verdict: "suspicious",
      observedAt: new Date("2026-03-12T13:00:00Z"),
    });

    expect(duplicate.emit).toBe(false);
    expect(duplicate.reason).toBe("cooldown_active");
  });
});
