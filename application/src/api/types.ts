import { z } from "zod";

/**
 * Polymarket API Type Definitions
 * 
 * Types for Gamma API (market discovery) and CLOB/Data API (trade data)
 */

// =============================================================================
// Gamma API Types (Market Discovery)
// =============================================================================

/**
 * Market outcome from Gamma API
 */
export const gammaOutcomeSchema = z.object({
  id: z.string(),
  title: z.string(),
  price: z.string().transform((v) => parseFloat(v)),
});

export type GammaOutcome = z.infer<typeof gammaOutcomeSchema>;

/**
 * Helper to parse JSON strings or pass through arrays
 * The Gamma API sometimes returns these fields as JSON-encoded strings
 */
const jsonStringOrArray = <T>(itemSchema: z.ZodType<T>) =>
  z.union([
    z.string().transform((s) => {
      try {
        return JSON.parse(s) as T[];
      } catch {
        return [] as T[];
      }
    }),
    z.array(itemSchema),
  ]);

const nullableStringNumberSchema = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === "") {
      return 0;
    }

    return typeof value === "number" ? value : parseFloat(value);
  });

/**
 * Outcomes schema - handles multiple formats from the API:
 * 1. JSON string of titles: "[\"Yes\",\"No\"]"
 * 2. Array of strings: ["Yes", "No"]
 * 3. Array of outcome objects: [{id: "...", title: "Yes", price: "0.65"}, ...]
 * 
 * Always normalizes to string[] (outcome titles)
 */
const outcomesSchema = z.union([
  // JSON string that parses to string[] or object[]
  z.string().transform((s) => {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        return parsed as string[];
      }
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "object" && item !== null)) {
        return parsed.map((item) => (item as { title?: string }).title ?? "") as string[];
      }
      return [] as string[];
    } catch {
      return [] as string[];
    }
  }),
  // Array of strings
  z.array(z.string()),
  // Array of outcome objects - extract titles
  z.array(gammaOutcomeSchema).transform((arr) => arr.map((o) => o.title)),
]);

/**
 * Outcome prices schema - handles:
 * 1. JSON string of price strings: "[\"0.65\",\"0.35\"]"
 * 2. Array of strings: ["0.65", "0.35"]
 * 3. Array of numbers: [0.65, 0.35]
 * 
 * Always normalizes to number[]
 */
const outcomePricesSchema = z.union([
  // JSON string that parses to string[] or number[]
  z.string().transform((s) => {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => typeof v === "string" ? parseFloat(v) : Number(v));
      }
      return [] as number[];
    } catch {
      return [] as number[];
    }
  }),
  // Array of strings - convert to numbers
  z.array(z.string()).transform((arr) => arr.map((v) => parseFloat(v))),
  // Array of numbers
  z.array(z.number()),
]);

/**
 * Market from Gamma API
 */
export const gammaMarketSchema = z.object({
  id: z.string(),
  question: z.string(),
  conditionId: z.string(),
  slug: z.string(),
  resolutionSource: z.string().optional(),
  endDate: z.string().nullable().optional(),
  liquidity: nullableStringNumberSchema,
  volume: nullableStringNumberSchema,
  active: z.boolean(),
  closed: z.boolean(),
  archived: z.boolean().optional(),
  acceptingOrders: z.boolean().optional(),
  groupItemTitle: z.string().nullable().optional(),
  groupItemThreshold: z.union([z.string(), z.number(), z.null()]).optional(),
  questionID: z.string().optional(),
  negRiskMarketID: z.string().optional(),
  // These fields can come as JSON strings, arrays of strings, or arrays of objects
  outcomes: outcomesSchema.optional(),
  outcomePrices: outcomePricesSchema.optional(),
  clobTokenIds: jsonStringOrArray(z.string()).optional(),
});

export type GammaMarket = z.infer<typeof gammaMarketSchema>;

/**
 * Event (collection of markets) from Gamma API
 */
export const gammaEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().nullable().optional(),
  markets: z.array(gammaMarketSchema).optional(),
  volume: nullableStringNumberSchema.optional(),
  liquidity: nullableStringNumberSchema.optional(),
  competitionState: z.string().optional(),
  showAllOutcomes: z.boolean().optional(),
  negRiskMarketID: z.string().optional(),
});

export type GammaEvent = z.infer<typeof gammaEventSchema>;

/**
 * Gamma API list response wrapper
 */
export const gammaListResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.array(itemSchema);

// =============================================================================
// CLOB/Data API Types (Trade Data)
// =============================================================================

/**
 * Trade from CLOB API
 */
const clobNumberLikeSchema = z.union([z.number(), z.string()]).transform((value) =>
  typeof value === "number" ? value : parseFloat(value)
);

const clobTimestampSchema = z.union([z.number(), z.string()]).transform((value) => {
  if (typeof value === "number") {
    return new Date(value * 1000).toISOString();
  }

  const maybeEpoch = Number(value);
  if (Number.isFinite(maybeEpoch) && /^\d+(\.\d+)?$/.test(value)) {
    return new Date(maybeEpoch * 1000).toISOString();
  }

  return new Date(value).toISOString();
});

const legacyClobTradeSchema = z.object({
  id: z.string(),
  taker_order_id: z.string(),
  market: z.string(),
  asset_id: z.string(),
  side: z.enum(["BUY", "SELL"]),
  size: z.string().transform((v) => parseFloat(v)),
  fee_rate_bps: z.string().transform((v) => parseFloat(v)),
  price: z.string().transform((v) => parseFloat(v)),
  status: z.string(),
  match_time: z.string(),
  last_update: z.string().optional(),
  outcome: z.string().optional(),
  bucket_index: z.number().optional(),
  owner: z.string().optional(),
  maker_address: z.string().optional(),
  transaction_hash: z.string().optional(),
  trader_side: z.enum(["TAKER", "MAKER"]).optional(),
});

const dataApiTradeSchema = z
  .object({
    proxyWallet: z.string().optional(),
    side: z.enum(["BUY", "SELL"]),
    asset: z.string(),
    conditionId: z.string(),
    size: clobNumberLikeSchema,
    price: clobNumberLikeSchema,
    timestamp: clobTimestampSchema,
    outcome: z.string().optional(),
    transactionHash: z.string().optional(),
  })
  .transform((trade) => {
    const syntheticId = trade.transactionHash ?? `${trade.conditionId}:${trade.asset}:${trade.timestamp}`;

    return {
      id: syntheticId,
      taker_order_id: syntheticId,
      market: trade.conditionId,
      asset_id: trade.asset,
      side: trade.side,
      size: trade.size,
      fee_rate_bps: 0,
      price: trade.price,
      status: "MATCHED",
      match_time: trade.timestamp,
      outcome: trade.outcome,
      owner: trade.proxyWallet,
      maker_address: undefined,
      transaction_hash: trade.transactionHash,
    };
  });

export const clobTradeSchema = z.union([legacyClobTradeSchema, dataApiTradeSchema]);

export type ClobTrade = z.infer<typeof clobTradeSchema>;

/**
 * Open interest from CLOB API
 */
export const clobOpenInterestSchema = z.object({
  market: z.string(),
  asset_id: z.string(),
  oi: z.string().transform((v) => parseFloat(v)),
  timestamp: z.string().optional(),
});

export type ClobOpenInterest = z.infer<typeof clobOpenInterestSchema>;

/**
 * Paginated response from CLOB API
 */
export const clobPaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    next_cursor: z.string().optional(),
    limit: z.number().optional(),
  });

const numberLikeSchema = z.union([z.number(), z.string()]).transform((value) =>
  typeof value === "number" ? value : parseFloat(value)
);

const optionalNumberLikeSchema = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === "") {
      return 0;
    }

    return typeof value === "number" ? value : parseFloat(value);
  });

const dateLikeSchema = z.union([z.number(), z.string(), z.date()]).transform((value) => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number") {
    return new Date(value * 1000);
  }

  const maybeEpoch = Number(value);
  if (Number.isFinite(maybeEpoch) && /^\d+(\.\d+)?$/.test(value)) {
    return new Date(maybeEpoch * 1000);
  }

  return new Date(value);
});

const optionalDateLikeSchema = z
  .union([z.number(), z.string(), z.date(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (value instanceof Date) {
      return value;
    }

    if (typeof value === "number") {
      return new Date(value * 1000);
    }

    const maybeEpoch = Number(value);
    if (Number.isFinite(maybeEpoch) && /^\d+(\.\d+)?$/.test(value)) {
      return new Date(maybeEpoch * 1000);
    }

    return new Date(value);
  });

// =============================================================================
// Data API Types (Activity, Positions, Holders)
// =============================================================================

export const dataActivitySchema = z.object({
  proxyWallet: z.string(),
  timestamp: dateLikeSchema,
  conditionId: z.string(),
  type: z.string(),
  size: optionalNumberLikeSchema,
  usdcSize: optionalNumberLikeSchema,
  transactionHash: z.string().optional(),
  price: z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((value) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    return typeof value === "number" ? value : parseFloat(value);
  }),
  asset: z.string().optional(),
  side: z.enum(["BUY", "SELL"]).optional(),
  outcomeIndex: z.number().optional(),
  title: z.string().optional(),
  slug: z.string().optional(),
  icon: z.string().optional(),
  eventSlug: z.string().optional(),
  outcome: z.string().nullable().optional(),
});

export type DataActivity = z.infer<typeof dataActivitySchema>;

export const dataPositionSchema = z.object({
  proxyWallet: z.string(),
  asset: z.string(),
  conditionId: z.string(),
  size: optionalNumberLikeSchema,
  avgPrice: optionalNumberLikeSchema,
  initialValue: optionalNumberLikeSchema,
  currentValue: optionalNumberLikeSchema,
  cashPnl: optionalNumberLikeSchema,
  percentPnl: optionalNumberLikeSchema,
  totalBought: optionalNumberLikeSchema,
  realizedPnl: optionalNumberLikeSchema,
  percentRealizedPnl: optionalNumberLikeSchema,
  curPrice: optionalNumberLikeSchema,
  redeemable: z.boolean().optional().default(false),
  mergeable: z.boolean().optional().default(false),
  title: z.string().optional(),
  slug: z.string().optional(),
  icon: z.string().optional(),
  eventSlug: z.string().optional(),
  outcome: z.string().nullable().optional(),
  outcomeIndex: z.number().optional(),
  oppositeOutcome: z.string().nullable().optional(),
  oppositeAsset: z.string().nullable().optional(),
  endDate: optionalDateLikeSchema,
  negativeRisk: z.boolean().optional(),
});

export type DataPosition = z.infer<typeof dataPositionSchema>;

export const closedPositionSchema = z.object({
  proxyWallet: z.string(),
  asset: z.string(),
  conditionId: z.string(),
  avgPrice: optionalNumberLikeSchema,
  totalBought: optionalNumberLikeSchema,
  realizedPnl: optionalNumberLikeSchema,
  curPrice: optionalNumberLikeSchema,
  timestamp: dateLikeSchema,
  title: z.string().optional(),
  slug: z.string().optional(),
  icon: z.string().optional(),
  eventSlug: z.string().optional(),
  outcome: z.string().nullable().optional(),
  outcomeIndex: z.number().optional(),
  oppositeOutcome: z.string().nullable().optional(),
  oppositeAsset: z.string().nullable().optional(),
  endDate: optionalDateLikeSchema,
});

export type ClosedPosition = z.infer<typeof closedPositionSchema>;

export const marketHolderSchema = z.object({
  proxyWallet: z.string(),
  bio: z.string().optional(),
  asset: z.string(),
  pseudonym: z.string().optional(),
  amount: numberLikeSchema,
  displayUsernamePublic: z.boolean().optional(),
  outcomeIndex: z.number().optional(),
  name: z.string().optional(),
  profileImage: z.string().optional(),
  profileImageOptimized: z.string().optional(),
});

export type MarketHolder = z.infer<typeof marketHolderSchema>;

export const marketHolderGroupSchema = z.object({
  token: z.string(),
  holders: z.array(marketHolderSchema),
});

export type MarketHolderGroup = z.infer<typeof marketHolderGroupSchema>;

// =============================================================================
// Unified Types (Used by application)
// =============================================================================

/**
 * Normalized market representation
 */
export interface NormalizedMarket {
  id: string;
  question: string;
  slug: string;
  outcomes: string[];
  outcomePrices: number[];
  volume: number;
  liquidity: number;
  endDate: Date | null;
  active: boolean;
  closed: boolean;
  tokenIds: string[];
}

export type MarketStructure = "binary_yes_no" | "multi_outcome" | "unknown";

export function normalizeOutcomeLabel(label: string | null | undefined): string {
  return (label ?? "").trim().toLowerCase();
}

export function isYesOutcomeLabel(label: string | null | undefined): boolean {
  return normalizeOutcomeLabel(label) === "yes";
}

export function isNoOutcomeLabel(label: string | null | undefined): boolean {
  return normalizeOutcomeLabel(label) === "no";
}

export function getMarketStructure(market: Pick<NormalizedMarket, "outcomes" | "tokenIds">): MarketStructure {
  const normalizedOutcomes = market.outcomes.map((outcome) => normalizeOutcomeLabel(outcome));

  if (normalizedOutcomes.length === 2 && normalizedOutcomes.includes("yes") && normalizedOutcomes.includes("no")) {
    return "binary_yes_no";
  }

  if (normalizedOutcomes.length > 0 || market.tokenIds.length > 2) {
    return "multi_outcome";
  }

  return "unknown";
}

export function isBinaryYesNoMarket(market: Pick<NormalizedMarket, "outcomes" | "tokenIds">): boolean {
  return getMarketStructure(market) === "binary_yes_no";
}

export function supportsClosingSoonWhaleAlerts(
  market: Pick<NormalizedMarket, "outcomes" | "tokenIds" | "endDate">
): market is Pick<NormalizedMarket, "outcomes" | "tokenIds"> & { endDate: Date } {
  return market.endDate !== null && isBinaryYesNoMarket(market);
}

/**
 * Normalized trade representation
 */
export interface NormalizedTrade {
  id: string;
  marketId: string;
  tokenId: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  timestamp: Date;
  outcome: string | null;
  traderAddress: string | null;
}

/**
 * API client options
 */
export interface ApiClientOptions {
  baseUrl?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}
