import type { MarketFamilyClassification } from "./market-family.js";

export type FamilyAnomalyPattern =
  | "none"
  | "one_child_spike"
  | "adjacent_bucket_spike"
  | "rotation"
  | "broad_repricing";

export type FamilyAnomalySeverity = "low" | "medium" | "high";

export interface FamilyChildSnapshot {
  slug: string;
  label: string;
  thresholdIndex: number | null;
  currentPrice: number;
  priceChange5m: number;
  priceChange1h: number;
  volume1h: number;
  volume24h: number;
  liquidity: number;
  openInterest: number;
}

export interface FamilyAnomalyInput {
  familySlug: string;
  classification: MarketFamilyClassification;
  children: FamilyChildSnapshot[];
}

export interface FamilyAnomalyResult {
  pattern: FamilyAnomalyPattern;
  severity: FamilyAnomalySeverity;
  impactedChildren: string[];
  reasons: string[];
}

const SHORT_MOVE_THRESHOLD = 0.08;
const HOUR_MOVE_THRESHOLD = 0.12;

function isSpikingChild(child: FamilyChildSnapshot): boolean {
  const movement = Math.abs(child.priceChange5m) >= SHORT_MOVE_THRESHOLD || Math.abs(child.priceChange1h) >= HOUR_MOVE_THRESHOLD;
  const liquidityPressure = child.volume1h >= Math.max(15000, child.liquidity * 0.25);
  return movement && liquidityPressure;
}

function sign(value: number): -1 | 0 | 1 {
  if (value > 0) {
    return 1;
  }

  if (value < 0) {
    return -1;
  }

  return 0;
}

function areAdjacent(children: FamilyChildSnapshot[]): boolean {
  const thresholds = children
    .map((child) => child.thresholdIndex)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  if (thresholds.length < 2) {
    return false;
  }

  for (let index = 1; index < thresholds.length; index++) {
    const current = thresholds[index];
    const previous = thresholds[index - 1];

    if (current === undefined || previous === undefined || current !== previous + 1) {
      return false;
    }
  }

  return true;
}

export function detectFamilyAnomaly(input: FamilyAnomalyInput): FamilyAnomalyResult {
  const spikingChildren = input.children.filter(isSpikingChild);

  if (spikingChildren.length === 0) {
    return {
      pattern: "none",
      severity: "low",
      impactedChildren: [],
      reasons: [],
    };
  }

  const positiveSpikes = spikingChildren.filter((child) => sign(child.priceChange5m || child.priceChange1h) > 0);
  const negativeSpikes = spikingChildren.filter((child) => sign(child.priceChange5m || child.priceChange1h) < 0);
  const sameDirection = positiveSpikes.length === 0 || negativeSpikes.length === 0;

  if (spikingChildren.length >= Math.max(3, input.children.length - 1) && sameDirection) {
    return {
      pattern: "broad_repricing",
      severity: "medium",
      impactedChildren: spikingChildren.map((child) => child.slug),
      reasons: ["most active children repriced in the same direction"],
    };
  }

  if (positiveSpikes.length >= 1 && negativeSpikes.length >= 1) {
    const rotatedChildren = [...negativeSpikes, ...positiveSpikes]
      .sort((left, right) => (left.thresholdIndex ?? 0) - (right.thresholdIndex ?? 0))
      .slice(0, 2)
      .map((child) => child.slug);

    return {
      pattern: "rotation",
      severity: "medium",
      impactedChildren: rotatedChildren,
      reasons: ["capital rotated between sibling contracts"],
    };
  }

  if (
    spikingChildren.length >= 2 &&
    sameDirection &&
    areAdjacent(spikingChildren) &&
    (input.classification === "grouped_date_threshold" || input.classification === "grouped_exact_date")
  ) {
    return {
      pattern: "adjacent_bucket_spike",
      severity: "high",
      impactedChildren: spikingChildren.map((child) => child.slug),
      reasons: ["adjacent thresholds moved together"],
    };
  }

  const [primary] = spikingChildren.sort((left, right) => Math.abs(right.priceChange5m) - Math.abs(left.priceChange5m));

  return {
    pattern: "one_child_spike",
    severity: "high",
    impactedChildren: primary ? [primary.slug] : [],
    reasons: ["single child repriced sharply relative to siblings"],
  };
}
