import { buildAnalystAlert, type AnalystAlert, type AnalystWalletFinding, type EventClock } from "./alert-pipeline.js";
import { detectFamilyAnomaly, type FamilyAnomalyInput, type FamilyAnomalyResult, type FamilyChildSnapshot } from "./family-anomaly.js";
import type { MarketFamily } from "./market-family.js";
import {
  buildWalletClusters,
  scoreSuspiciousWalletActivity,
  type WalletCluster,
  type WalletEntryObservation,
  type WalletSuspiciousnessInput,
  type WalletSuspiciousnessResult,
} from "./wallet-surveillance.js";

export interface SurveillanceWalletFinding extends AnalystWalletFinding {
  familySlug: string;
}

export interface SurveillancePipelineInput {
  family: MarketFamily;
  childSnapshots: FamilyChildSnapshot[];
  walletEntries: WalletEntryObservation[];
  walletInputs: WalletSuspiciousnessInput[];
  eventClock: EventClock;
  generatedAt: Date;
}

export interface SurveillancePipelineResult {
  anomaly: FamilyAnomalyResult;
  clusters: WalletCluster[];
  walletFindings: SurveillanceWalletFinding[];
  alert: AnalystAlert;
}

function buildWalletFinding(
  input: WalletSuspiciousnessInput,
  result: WalletSuspiciousnessResult
): SurveillanceWalletFinding {
  return {
    wallet: input.wallet,
    familySlug: input.familySlug,
    childSlug: input.childSlug,
    score: result.score,
    band: result.band,
    reasons: result.reasons,
    priorActivityCount: input.priorActivityCount,
    repeatedPreEventWins: input.repeatedPreEventWins,
    realizedPnlUsd: 0,
    currentExposureUsd: input.notionalUsd,
    ...(input.tradeDirection !== undefined ? { tradeDirection: input.tradeDirection } : {}),
    ...(input.tradePrice !== undefined ? { tradePrice: input.tradePrice } : {}),
    ...(input.largestTradeUsd !== undefined ? { largestTradeUsd: input.largestTradeUsd } : { largestTradeUsd: input.notionalUsd }),
    ...(input.walletAgeMinutes !== undefined ? { walletAgeMinutes: input.walletAgeMinutes } : {}),
  };
}

function getClusterSize(wallet: string, clusters: WalletCluster[]): number {
  const cluster = clusters.find((candidate) => candidate.wallets.includes(wallet));
  return cluster ? cluster.wallets.length : 1;
}

export function runSurveillancePipeline(input: SurveillancePipelineInput): SurveillancePipelineResult {
  const anomalyInput: FamilyAnomalyInput = {
    familySlug: input.family.slug,
    classification: input.family.classification,
    children: input.childSnapshots,
  };
  const anomaly = detectFamilyAnomaly(anomalyInput);
  const clusters = buildWalletClusters(input.walletEntries);
  const walletFindings = input.walletInputs
    .map((walletInput) => {
      const clusterSize = Math.max(walletInput.clusterSize, getClusterSize(walletInput.wallet, clusters));
      const result = scoreSuspiciousWalletActivity({
        ...walletInput,
        clusterSize,
      });
      return buildWalletFinding(walletInput, result);
    })
    .sort((left, right) => right.score - left.score);

  const alert = buildAnalystAlert({
    family: {
      slug: input.family.slug,
      title: input.family.title,
      classification: input.family.classification,
      childMarkets: input.family.childMarkets,
    },
    anomaly,
    eventClock: input.eventClock,
    walletFindings,
    childSnapshots: input.childSnapshots,
    clusters,
    generatedAt: input.generatedAt,
  });

  return {
    anomaly,
    clusters,
    walletFindings,
    alert,
  };
}
