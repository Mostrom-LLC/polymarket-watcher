import { compareVerdicts, type AnalystVerdict } from "./alert-pipeline.js";

export interface ReplayLedgerOptions {
  cooldownMs: number;
}

export interface ReplayLedgerEntry {
  fingerprint: string;
  verdict: AnalystVerdict;
  observedAt: string;
}

export interface ReplayLedgerSnapshot {
  entries: ReplayLedgerEntry[];
}

export interface ReplayLedgerRecordInput {
  fingerprint: string;
  verdict: AnalystVerdict;
  observedAt: Date;
}

export interface ReplayLedgerDecision {
  emit: boolean;
  reason: "new_alert" | "cooldown_active" | "severity_escalation" | "cooldown_elapsed";
}

export class ReplayLedger {
  private readonly cooldownMs: number;
  private readonly entries = new Map<string, { verdict: AnalystVerdict; observedAtMs: number }>();

  constructor(options: ReplayLedgerOptions) {
    this.cooldownMs = options.cooldownMs;
  }

  static fromSnapshot(snapshot: ReplayLedgerSnapshot, options: ReplayLedgerOptions): ReplayLedger {
    const ledger = new ReplayLedger(options);

    for (const entry of snapshot.entries) {
      ledger.entries.set(entry.fingerprint, {
        verdict: entry.verdict,
        observedAtMs: new Date(entry.observedAt).getTime(),
      });
    }

    return ledger;
  }

  snapshot(): ReplayLedgerSnapshot {
    return {
      entries: [...this.entries.entries()].map(([fingerprint, entry]) => ({
        fingerprint,
        verdict: entry.verdict,
        observedAt: new Date(entry.observedAtMs).toISOString(),
      })),
    };
  }

  record(input: ReplayLedgerRecordInput): ReplayLedgerDecision {
    const existing = this.entries.get(input.fingerprint);
    const observedAtMs = input.observedAt.getTime();

    if (!existing) {
      this.entries.set(input.fingerprint, { verdict: input.verdict, observedAtMs });
      return { emit: true, reason: "new_alert" };
    }

    if (observedAtMs - existing.observedAtMs < this.cooldownMs) {
      if (compareVerdicts(input.verdict, existing.verdict) > 0) {
        this.entries.set(input.fingerprint, { verdict: input.verdict, observedAtMs });
        return { emit: true, reason: "severity_escalation" };
      }

      return { emit: false, reason: "cooldown_active" };
    }

    this.entries.set(input.fingerprint, { verdict: input.verdict, observedAtMs });
    return { emit: true, reason: "cooldown_elapsed" };
  }
}
