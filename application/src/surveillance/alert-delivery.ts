import type { AnalystAlert } from "./alert-pipeline.js";
import { ReplayLedger, type ReplayLedgerDecision, type ReplayLedgerSnapshot } from "./replay-ledger.js";

export interface AnalystAlertNotifier {
  sendAnalystAlert(alert: AnalystAlert, channel?: string): Promise<unknown>;
}

export interface DeliverAnalystAlertInput {
  alert: AnalystAlert;
  notifier: AnalystAlertNotifier;
  snapshot: ReplayLedgerSnapshot;
  cooldownMs: number;
  channel?: string;
}

export interface DeliverAnalystAlertResult {
  sent: boolean;
  decision: ReplayLedgerDecision;
  snapshot: ReplayLedgerSnapshot;
}

export async function deliverAnalystAlert(
  input: DeliverAnalystAlertInput
): Promise<DeliverAnalystAlertResult> {
  const ledger = ReplayLedger.fromSnapshot(input.snapshot, {
    cooldownMs: input.cooldownMs,
  });

  const decision = ledger.record({
    fingerprint: input.alert.fingerprint,
    verdict: input.alert.verdict,
    observedAt: input.alert.generatedAt,
  });

  if (decision.emit) {
    await input.notifier.sendAnalystAlert(input.alert, input.channel);
  }

  return {
    sent: decision.emit,
    decision,
    snapshot: ledger.snapshot(),
  };
}
