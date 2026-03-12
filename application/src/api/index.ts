/**
 * Polymarket API Clients
 * 
 * This module provides typed clients for interacting with the Polymarket APIs.
 */

// Export clients
export { GammaApiClient } from "./gamma-client.js";
export { ClobApiClient } from "./clob-client.js";
export { DataApiClient } from "./data-client.js";

// Export types
export type {
  GammaMarket,
  GammaEvent,
  GammaOutcome,
  ClobTrade,
  ClobOpenInterest,
  DataActivity,
  DataPosition,
  ClosedPosition,
  MarketHolder,
  MarketHolderGroup,
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
  dataActivitySchema,
  dataPositionSchema,
  closedPositionSchema,
  marketHolderSchema,
  marketHolderGroupSchema,
} from "./types.js";
