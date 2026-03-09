/**
 * Polymarket API Clients
 * 
 * This module provides typed clients for interacting with the Polymarket APIs.
 */

// Export unified client (recommended)
export { PolymarketClient, type Market, type Trade } from "./polymarket-client.js";

// Export individual clients (advanced usage)
export { GammaApiClient } from "./gamma-client.js";
export { ClobApiClient } from "./clob-client.js";

// Export types
export type {
  GammaMarket,
  GammaEvent,
  GammaOutcome,
  ClobTrade,
  ClobOpenInterest,
  NormalizedMarket,
  NormalizedTrade,
  ApiClientOptions,
} from "./types.js";

// Export schemas for external validation
export {
  gammaMarketSchema,
  gammaEventSchema,
  gammaOutcomeSchema,
  clobTradeSchema,
  clobOpenInterestSchema,
} from "./types.js";
