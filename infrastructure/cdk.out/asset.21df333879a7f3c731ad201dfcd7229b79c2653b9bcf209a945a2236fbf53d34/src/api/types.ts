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
  endDate: z.string().optional(),
  liquidity: z.string().transform((v) => parseFloat(v)),
  volume: z.string().transform((v) => parseFloat(v)),
  active: z.boolean(),
  closed: z.boolean(),
  archived: z.boolean().optional(),
  acceptingOrders: z.boolean().optional(),
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
  endDate: z.string().optional(),
  markets: z.array(gammaMarketSchema).optional(),
  volume: z.string().transform((v) => parseFloat(v)).optional(),
  liquidity: z.string().transform((v) => parseFloat(v)).optional(),
  competitionState: z.string().optional(),
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
export const clobTradeSchema = z.object({
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
