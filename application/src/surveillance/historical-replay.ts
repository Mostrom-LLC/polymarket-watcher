import { deliverAnalystAlert, type AnalystAlertNotifier } from "./alert-delivery.js";
import type { ReplayLedgerSnapshot } from "./replay-ledger.js";
import { runSurveillancePipeline, type SurveillancePipelineInput } from "./surveillance-pipeline.js";
import type { AnalystAlert } from "./alert-pipeline.js";

export interface HistoricalReplayInput {
  frames: SurveillancePipelineInput[];
  notifier: AnalystAlertNotifier;
  cooldownMs: number;
  snapshot?: ReplayLedgerSnapshot;
}

export interface HistoricalReplayResult {
  deliveredAlerts: AnalystAlert[];
  suppressedAlerts: number;
  snapshot: ReplayLedgerSnapshot;
}

export async function runHistoricalReplay(input: HistoricalReplayInput): Promise<HistoricalReplayResult> {
  let snapshot = input.snapshot ?? { entries: [] };
  const deliveredAlerts: AnalystAlert[] = [];
  let suppressedAlerts = 0;

  const frames = [...input.frames].sort((left, right) => left.generatedAt.getTime() - right.generatedAt.getTime());

  for (const frame of frames) {
    const pipelineResult = runSurveillancePipeline(frame);
    const delivery = await deliverAnalystAlert({
      alert: pipelineResult.alert,
      notifier: input.notifier,
      snapshot,
      cooldownMs: input.cooldownMs,
    });

    snapshot = delivery.snapshot;

    if (delivery.sent) {
      deliveredAlerts.push(pipelineResult.alert);
    } else {
      suppressedAlerts++;
    }
  }

  return {
    deliveredAlerts,
    suppressedAlerts,
    snapshot,
  };
}
