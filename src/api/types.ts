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
  outcomes: z.array(gammaOutcomeSchema).optional(),
  outcomePrices: z.array(z.string().transform((v) => parseFloat(v))).optional(),
  clobTokenIds: z.array(z.string()).optional(),
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
  /** Rate limit: requests per second (default: 5) */
  requestsPerSecond?: number;
  /** Rate limit: max concurrent requests (default: 3) */
  maxConcurrent?: number;
  /** Enable debug logging */
  debug?: boolean;
}
