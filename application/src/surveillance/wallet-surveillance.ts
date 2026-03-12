export interface WalletEntryObservation {
  wallet: string;
  firstSeenAt: Date;
  familySlug: string;
  childSlug: string;
  enteredAt: Date;
  direction: "YES" | "NO" | "UNKNOWN";
  notionalUsd: number;
  priorCoAppearanceCount: number;
}

export interface WalletCluster {
  familySlug: string;
  wallets: string[];
  reasons: string[];
}

export interface WalletSuspiciousnessInput {
  wallet: string;
  familySlug: string;
  childSlug: string;
  firstSeenAt: Date;
  tradePlacedAt: Date;
  eventOccurredAt: Date;
  timestampSource: "official_source" | "trusted_news" | "manual_analyst" | "market_deadline";
  notionalUsd: number;
  recentVolume1hUsd: number;
  recentLiquidityUsd: number;
  openInterestUsd: number;
  clusterSize: number;
  repeatedPreEventWins: number;
  contractSpecificity: "broad_binary" | "date_threshold" | "exact_date" | "candidate_field" | "mention_count";
  priorActivityCount: number;
  tradeDirection?: "YES" | "NO" | "UNKNOWN";
  tradePrice?: number;
  largestTradeUsd?: number;
  walletAgeMinutes?: number;
}

export interface WalletSuspiciousnessResult {
  score: number;
  band: "low" | "medium" | "high";
  reasons: string[];
}

function minutesBetween(left: Date, right: Date): number {
  return Math.abs(left.getTime() - right.getTime()) / (1000 * 60);
}

function hoursBetween(left: Date, right: Date): number {
  return Math.abs(left.getTime() - right.getTime()) / (1000 * 60 * 60);
}

export function buildWalletClusters(observations: WalletEntryObservation[]): WalletCluster[] {
  const clusters: WalletCluster[] = [];
  const grouped = new Map<string, WalletEntryObservation[]>();

  for (const observation of observations) {
    const key = `${observation.familySlug}:${observation.direction}`;
    const existing = grouped.get(key) ?? [];
    existing.push(observation);
    grouped.set(key, existing);
  }

  for (const familyObservations of grouped.values()) {
    const sorted = [...familyObservations].sort((left, right) => left.enteredAt.getTime() - right.enteredAt.getTime());
    const candidate = sorted.filter((observation) => sorted.every((other) => {
      const firstSeenCompatible = hoursBetween(observation.firstSeenAt, other.firstSeenAt) <= 24;
      const entryWindowCompatible = minutesBetween(observation.enteredAt, other.enteredAt) <= 15;
      const sizeRatio = Math.max(observation.notionalUsd, other.notionalUsd) / Math.max(1, Math.min(observation.notionalUsd, other.notionalUsd));
      return firstSeenCompatible && entryWindowCompatible && sizeRatio <= 2;
    }));

    if (candidate.length >= 2) {
      const reasons = ["same family entry window", "similar sizing pattern"];
      if (candidate.some((item) => item.priorCoAppearanceCount >= 2)) {
        reasons.push("repeated co-appearance across prior families");
      }

      clusters.push({
        familySlug: candidate[0]!.familySlug,
        wallets: candidate.map((item) => item.wallet),
        reasons,
      });
    }
  }

  return clusters;
}

export function scoreSuspiciousWalletActivity(
  input: WalletSuspiciousnessInput
): WalletSuspiciousnessResult {
  let score = 0;
  const reasons: string[] = [];

  if (input.priorActivityCount <= 2) {
    score += 25;
    reasons.push("new or low-history wallet");
  }

  if (minutesBetween(input.tradePlacedAt, input.eventOccurredAt) <= 120) {
    score += 20;
    reasons.push("short lead time to catalyst");
  }

  if (input.recentLiquidityUsd > 0 && input.notionalUsd / input.recentLiquidityUsd >= 0.75) {
    score += 20;
    reasons.push("large size relative to liquidity");
  }

  if (input.recentVolume1hUsd > 0 && input.notionalUsd / input.recentVolume1hUsd >= 0.5) {
    score += 10;
    reasons.push("large size relative to recent volume");
  }

  if (input.openInterestUsd > 0 && input.notionalUsd / input.openInterestUsd >= 0.5) {
    score += 10;
  }

  if (input.clusterSize >= 2) {
    score += 15;
    reasons.push("clustered wallet entry");
  }

  if (input.repeatedPreEventWins >= 2) {
    score += 10;
  }

  if (input.contractSpecificity === "exact_date") {
    score += 10;
  } else if (input.contractSpecificity === "date_threshold" || input.contractSpecificity === "mention_count") {
    score += 5;
  }

  const boundedScore = Math.min(100, score);
  const band = boundedScore >= 80 ? "high" : boundedScore >= 50 ? "medium" : "low";

  return {
    score: boundedScore,
    band,
    reasons,
  };
}
