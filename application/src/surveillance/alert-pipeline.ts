import type { FamilyAnomalyResult, FamilyChildSnapshot } from "./family-anomaly.js";
import type { MarketFamily, MarketFamilyClassification } from "./market-family.js";
import type { WalletCluster } from "./wallet-surveillance.js";

export type AnalystVerdict = "benign" | "watchlist" | "suspicious" | "escalated";
export type EventTimestampSource = "official_source" | "trusted_news" | "manual_analyst" | "market_deadline";

export interface EventClock {
  occurredAt: Date;
  source: EventTimestampSource;
  publishedAt: Date | null;
}

export interface AnalystWalletFinding {
  wallet: string;
  childSlug: string;
  score: number;
  band: "low" | "medium" | "high";
  reasons: string[];
  priorActivityCount: number;
  repeatedPreEventWins: number;
  realizedPnlUsd: number;
  currentExposureUsd: number;
  tradeDirection?: "YES" | "NO" | "UNKNOWN";
  tradePrice?: number;
  largestTradeUsd?: number;
  walletAgeMinutes?: number;
}

export interface AnalystAlertInput {
  family: Pick<MarketFamily, "slug" | "title" | "classification" | "childMarkets">;
  anomaly: FamilyAnomalyResult;
  eventClock: EventClock;
  walletFindings: AnalystWalletFinding[];
  childSnapshots: FamilyChildSnapshot[];
  clusters: WalletCluster[];
  generatedAt: Date;
}

export interface AnalystPriceMove {
  fromPrice: number;
  toPrice: number;
  deltaPoints: number;
}

export interface AnalystLargestTrade {
  wallet: string;
  childSlug: string;
  contractLabel?: string | null;
  notionalUsd: number;
  direction: "YES" | "NO" | "UNKNOWN";
  price: number | null;
  walletAgeMinutes: number | null;
}

export interface AnalystAlert {
  fingerprint: string;
  verdict: AnalystVerdict;
  summary: string;
  familySlug: string;
  familyTitle: string;
  classification: MarketFamilyClassification;
  anomalyPattern: FamilyAnomalyResult["pattern"];
  anomalySeverity: FamilyAnomalyResult["severity"];
  marketLabel: string;
  marketChildSlug?: string | null;
  marketChildLabel?: string | null;
  direction: string;
  priceMove: AnalystPriceMove;
  largestTrade: AnalystLargestTrade;
  recommendation: string;
  topWallets: AnalystWalletFinding[];
  clusterCount: number;
  evidence: string[];
  generatedAt: Date;
}

const verdictRank: Record<AnalystVerdict, number> = {
  benign: 0,
  watchlist: 1,
  suspicious: 2,
  escalated: 3,
};

function unique(items: readonly string[]): string[] {
  return [...new Set(items.filter((item) => item.length > 0))];
}

function determineVerdict(
  anomaly: FamilyAnomalyResult,
  walletFindings: AnalystWalletFinding[],
  clusters: WalletCluster[]
): AnalystVerdict {
  const hasHighWallet = walletFindings.some((finding) => finding.band === "high");
  const hasMediumWallet = walletFindings.some((finding) => finding.band === "medium");

  if (anomaly.severity === "high" && hasHighWallet && clusters.length > 0) {
    return "escalated";
  }

  if (anomaly.severity === "high" || hasHighWallet) {
    return "suspicious";
  }

  if (anomaly.severity === "medium" || hasMediumWallet || clusters.length > 0) {
    return "watchlist";
  }

  return "benign";
}

export function compareVerdicts(left: AnalystVerdict, right: AnalystVerdict): number {
  return verdictRank[left] - verdictRank[right];
}

function getPrimaryChildSlug(input: AnalystAlertInput): string | null {
  return input.anomaly.impactedChildren[0] ?? input.childSnapshots[0]?.slug ?? input.walletFindings[0]?.childSlug ?? null;
}

function rankSnapshot(snapshot: FamilyChildSnapshot): number {
  return (
    snapshot.currentPrice * 1000 +
    snapshot.volume24h / 1000 +
    snapshot.liquidity / 2000 +
    snapshot.volume1h / 5000
  );
}

function pickDominantSnapshot(snapshots: readonly FamilyChildSnapshot[]): FamilyChildSnapshot | undefined {
  return [...snapshots].sort((left, right) => rankSnapshot(right) - rankSnapshot(left))[0];
}

function shouldPreferDominantSnapshot(
  anomalySnapshot: FamilyChildSnapshot | undefined,
  dominantSnapshot: FamilyChildSnapshot | undefined
): boolean {
  if (!dominantSnapshot) {
    return false;
  }

  if (!anomalySnapshot) {
    return true;
  }

  if (anomalySnapshot.slug === dominantSnapshot.slug) {
    return true;
  }

  const relativePriceShare = dominantSnapshot.currentPrice > 0
    ? anomalySnapshot.currentPrice / dominantSnapshot.currentPrice
    : 0;
  const anomalyHasMeaningfulShare =
    anomalySnapshot.currentPrice >= 0.05 ||
    (
      relativePriceShare >= 0.33 &&
      (
        anomalySnapshot.volume24h >= dominantSnapshot.volume24h * 0.5 ||
        anomalySnapshot.liquidity >= dominantSnapshot.liquidity * 0.5
      )
    );
  const dominantClearlyLeads =
    dominantSnapshot.currentPrice >= Math.max(0.15, anomalySnapshot.currentPrice * 3) &&
    dominantSnapshot.volume24h >= anomalySnapshot.volume24h * 1.5 &&
    dominantSnapshot.liquidity >= anomalySnapshot.liquidity * 1.5;

  return dominantClearlyLeads && !anomalyHasMeaningfulShare;
}

function pickPrimarySnapshot(input: AnalystAlertInput): FamilyChildSnapshot | undefined {
  const anomalyChildSlug = getPrimaryChildSlug(input);
  const anomalySnapshot = input.childSnapshots.find((child) => child.slug === anomalyChildSlug);
  const dominantSnapshot = pickDominantSnapshot(input.childSnapshots);

  if (shouldPreferDominantSnapshot(anomalySnapshot, dominantSnapshot)) {
    return dominantSnapshot;
  }

  return anomalySnapshot ?? dominantSnapshot ?? input.childSnapshots[0];
}

function formatMarketLabel(familyTitle: string, question: string): string {
  const trimmedQuestion = question.replace(/\?$/, "").trim();
  const prefix = familyTitle.replace(/\.\.\.\?$/, "").trim();

  if (/^will /i.test(trimmedQuestion)) {
    const stripped = trimmedQuestion.replace(/^will\s+/i, "");
    const capitalized = stripped.charAt(0).toUpperCase() + stripped.slice(1);
    return capitalized;
  }

  if (trimmedQuestion.toLowerCase().startsWith(prefix.toLowerCase())) {
    return trimmedQuestion;
  }

  return trimmedQuestion;
}

function buildDirectionLabel(wallet: AnalystWalletFinding | undefined, snapshot: FamilyChildSnapshot | undefined): string {
  const movement = snapshot
    ? Math.abs(snapshot.priceChange1h) >= Math.abs(snapshot.priceChange5m)
      ? snapshot.priceChange1h
      : snapshot.priceChange5m
    : 0;
  const tradeDirection = wallet?.tradeDirection;

  if (tradeDirection === "YES" || (tradeDirection === undefined && movement > 0)) {
    return "Heavy YES buying";
  }

  if (tradeDirection === "NO" || (tradeDirection === undefined && movement < 0)) {
    return "Heavy NO buying";
  }

  return "Mixed pressure";
}

function buildRecommendation(wallet: AnalystWalletFinding | undefined, snapshot: FamilyChildSnapshot | undefined): string {
  if (wallet?.tradeDirection === "YES") {
    return "Lean YES";
  }

  if (wallet?.tradeDirection === "NO") {
    return "Lean NO";
  }

  const movement = snapshot
    ? Math.abs(snapshot.priceChange1h) >= Math.abs(snapshot.priceChange5m)
      ? snapshot.priceChange1h
      : snapshot.priceChange5m
    : 0;

  if (movement > 0) {
    return "Lean YES";
  }

  if (movement < 0) {
    return "Lean NO";
  }

  return "Hold";
}

function buildPriceMove(snapshot: FamilyChildSnapshot | undefined): AnalystPriceMove {
  if (!snapshot) {
    return {
      fromPrice: 0,
      toPrice: 0,
      deltaPoints: 0,
    };
  }

  const delta = Math.abs(snapshot.priceChange1h) >= Math.abs(snapshot.priceChange5m)
    ? snapshot.priceChange1h
    : snapshot.priceChange5m;

  return {
    fromPrice: Number((snapshot.currentPrice - delta).toFixed(2)),
    toPrice: Number(snapshot.currentPrice.toFixed(2)),
    deltaPoints: Number(delta.toFixed(2)),
  };
}

function buildContractLabel(
  familyTitle: string,
  child: Pick<MarketFamily["childMarkets"][number], "groupItemTitle" | "question"> | undefined
): string | null {
  if (!child) {
    return null;
  }

  if (child.groupItemTitle) {
    return child.groupItemTitle;
  }

  return formatMarketLabel(familyTitle, child.question);
}

function buildLargestTrade(
  wallet: AnalystWalletFinding | undefined,
  familyTitle: string,
  childMarkets: readonly MarketFamily["childMarkets"][number][]
): AnalystLargestTrade {
  const child = childMarkets.find((candidate) => candidate.slug === wallet?.childSlug);

  return {
    wallet: wallet?.wallet ?? "unknown",
    childSlug: wallet?.childSlug ?? "",
    contractLabel: buildContractLabel(familyTitle, child),
    notionalUsd: wallet?.largestTradeUsd ?? wallet?.currentExposureUsd ?? 0,
    direction: wallet?.tradeDirection ?? "UNKNOWN",
    price: wallet?.tradePrice ?? null,
    walletAgeMinutes: wallet?.walletAgeMinutes ?? null,
  };
}

function getLargestTradeWallet(wallets: readonly AnalystWalletFinding[]): AnalystWalletFinding | undefined {
  return [...wallets].sort((left, right) => {
    const rightSize = right.largestTradeUsd ?? right.currentExposureUsd;
    const leftSize = left.largestTradeUsd ?? left.currentExposureUsd;

    if (rightSize !== leftSize) {
      return rightSize - leftSize;
    }

    return right.score - left.score;
  })[0];
}

function getPrimaryWallet(
  primaryChildSlug: string | undefined,
  wallets: readonly AnalystWalletFinding[]
): AnalystWalletFinding | undefined {
  const childWallets = wallets
    .filter((wallet) => wallet.childSlug === primaryChildSlug)
    .sort((left, right) => {
      const rightSize = right.largestTradeUsd ?? right.currentExposureUsd;
      const leftSize = left.largestTradeUsd ?? left.currentExposureUsd;

      if (rightSize !== leftSize) {
        return rightSize - leftSize;
      }

      return right.score - left.score;
    });

  return childWallets[0] ?? getLargestTradeWallet(wallets) ?? wallets[0];
}

export function buildAnalystAlert(input: AnalystAlertInput): AnalystAlert {
  const verdict = determineVerdict(input.anomaly, input.walletFindings, input.clusters);
  const topWallets = [...input.walletFindings].sort((left, right) => right.score - left.score).slice(0, 5);
  const primarySnapshot = pickPrimarySnapshot(input);
  const primaryChildSlug = primarySnapshot?.slug ?? getPrimaryChildSlug(input);
  const primaryChild = input.family.childMarkets.find((child) => child.slug === primaryChildSlug) ?? input.family.childMarkets[0];
  const primaryWallet = getPrimaryWallet(primaryChildSlug ?? undefined, topWallets);
  const largestTradeWallet = getLargestTradeWallet(topWallets);
  const evidence = unique([
    `timestamp source: ${input.eventClock.source}`,
    ...input.anomaly.reasons,
    ...input.clusters.flatMap((cluster) => cluster.reasons),
    ...topWallets.flatMap((wallet) => wallet.reasons),
  ]);
  const impacted = input.anomaly.impactedChildren.length > 0
    ? ` impacting ${input.anomaly.impactedChildren.length} contract${input.anomaly.impactedChildren.length === 1 ? "" : "s"}`
    : "";
  const summary = `${input.family.title}: ${input.anomaly.pattern}${impacted}`;

  return {
    fingerprint: [
      input.family.slug,
      input.anomaly.pattern,
      ...[...input.anomaly.impactedChildren].sort(),
    ].join(":"),
    verdict,
    summary,
    familySlug: input.family.slug,
    familyTitle: input.family.title,
    classification: input.family.classification,
    anomalyPattern: input.anomaly.pattern,
    anomalySeverity: input.anomaly.severity,
    marketLabel: formatMarketLabel(input.family.title, primaryChild?.question ?? input.family.title),
    marketChildSlug: primaryChildSlug ?? null,
    marketChildLabel: buildContractLabel(input.family.title, primaryChild),
    direction: buildDirectionLabel(primaryWallet, primarySnapshot),
    priceMove: buildPriceMove(primarySnapshot),
    largestTrade: buildLargestTrade(largestTradeWallet, input.family.title, input.family.childMarkets),
    recommendation: buildRecommendation(primaryWallet, primarySnapshot),
    topWallets,
    clusterCount: input.clusters.length,
    evidence,
    generatedAt: input.generatedAt,
  };
}
