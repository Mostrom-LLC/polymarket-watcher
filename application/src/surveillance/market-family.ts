import { type GammaEvent, type GammaMarket, normalizeOutcomeLabel } from "../api/types.js";

export type MarketFamilyClassification =
  | "standalone_binary"
  | "grouped_date_threshold"
  | "grouped_exact_date"
  | "candidate_field"
  | "mention_count_family"
  | "grouped_generic";

export interface MarketFamilyChild {
  id: string;
  slug: string;
  question: string;
  endDate: Date | null;
  groupItemTitle: string | null;
  groupItemThreshold: number | null;
  outcomes: string[];
  outcomePrices: number[];
  tokenIds: string[];
  active: boolean;
  closed: boolean;
  liquidity: number;
  volume: number;
}

export interface MarketFamily {
  eventId: string;
  slug: string;
  title: string;
  eventEndDate: Date | null;
  showAllOutcomes: boolean;
  classification: MarketFamilyClassification;
  childMarkets: MarketFamilyChild[];
}

const monthPattern =
  /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/i;

function parseOptionalDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function parseGroupThreshold(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return typeof value === "number" ? value : Number.parseFloat(value);
}

function isBinaryYesNoChild(market: Pick<GammaMarket, "outcomes">): boolean {
  const normalized = (market.outcomes ?? []).map((outcome) => normalizeOutcomeLabel(outcome));
  return normalized.length === 2 && normalized.includes("yes") && normalized.includes("no");
}

function isDateLikeLabel(value: string | null | undefined): boolean {
  return value !== undefined && value !== null && monthPattern.test(value);
}

function isCandidateFieldFamily(event: GammaEvent, children: MarketFamilyChild[]): boolean {
  const title = event.title.toLowerCase();
  if (!/nominee|election|primary/.test(title)) {
    return false;
  }

  return children.every((child) => !isDateLikeLabel(child.groupItemTitle));
}

function isMentionCountFamily(event: GammaEvent, children: MarketFamilyChild[]): boolean {
  const haystacks = [event.title, ...children.map((child) => child.question)].join(" ").toLowerCase();
  return /tweet|tweets|post|posts|truth social|say | mention|count/.test(haystacks);
}

function isGroupedExactDateFamily(event: GammaEvent, children: MarketFamilyChild[]): boolean {
  const haystacks = [event.title, ...children.map((child) => child.question)].join(" ").toLowerCase();
  return / ends on | on\.\.\.| strike .* on | on march| on april| on may| on june| on july| on august| on september| on october| on november| on december/.test(
    haystacks
  );
}

function isGroupedDateThresholdFamily(event: GammaEvent, children: MarketFamilyChild[]): boolean {
  const haystacks = [event.title, ...children.map((child) => child.question)].join(" ").toLowerCase();
  if (!children.every((child) => isDateLikeLabel(child.groupItemTitle) || isDateLikeLabel(child.question))) {
    return false;
  }

  return /\bby\b|before /.test(haystacks);
}

function normalizeChildMarket(market: GammaMarket): MarketFamilyChild {
  return {
    id: market.id,
    slug: market.slug,
    question: market.question,
    endDate: parseOptionalDate(market.endDate),
    groupItemTitle: market.groupItemTitle ?? null,
    groupItemThreshold: parseGroupThreshold(market.groupItemThreshold),
    outcomes: market.outcomes ?? [],
    outcomePrices: market.outcomePrices ?? [],
    tokenIds: market.clobTokenIds ?? [],
    active: market.active,
    closed: market.closed,
    liquidity: market.liquidity,
    volume: market.volume,
  };
}

export function classifyMarketFamily(event: GammaEvent): MarketFamily {
  const activeChildren = (event.markets ?? [])
    .filter((market) => market.active && !market.closed)
    .map(normalizeChildMarket)
    .filter((market) => market.outcomes.length > 0);

  const children = activeChildren.length > 0
    ? activeChildren
    : (event.markets ?? []).map(normalizeChildMarket).filter((market) => market.outcomes.length > 0);

  let classification: MarketFamilyClassification = "grouped_generic";

  if (!event.showAllOutcomes && children.length <= 1 && children.every((child) => isBinaryYesNoChild(child))) {
    classification = "standalone_binary";
  } else if (isMentionCountFamily(event, children)) {
    classification = "mention_count_family";
  } else if (isCandidateFieldFamily(event, children)) {
    classification = "candidate_field";
  } else if (isGroupedExactDateFamily(event, children)) {
    classification = "grouped_exact_date";
  } else if (isGroupedDateThresholdFamily(event, children)) {
    classification = "grouped_date_threshold";
  }

  return {
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    eventEndDate: parseOptionalDate(event.endDate),
    showAllOutcomes: event.showAllOutcomes ?? false,
    classification,
    childMarkets: children,
  };
}
