/**
 * Unified Polymarket API Client
 *
 * Provides a single interface for all Polymarket API operations
 * as required by MOS-85 acceptance criteria.
 */

import { GammaApiClient } from "./gamma-client.js";
import { ClobApiClient } from "./clob-client.js";
import type {
  NormalizedMarket,
  NormalizedTrade,
  ApiClientOptions,
} from "./types.js";

/**
 * Rate limiter for API requests
 */
class RateLimiter {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  private lastRequestTime = 0;
  private readonly minIntervalMs: number;
  private readonly maxConcurrent: number;
  private activeRequests = 0;

  constructor(requestsPerSecond: number = 5, maxConcurrent: number = 3) {
    this.minIntervalMs = 1000 / requestsPerSecond;
    this.maxConcurrent = maxConcurrent;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    if (this.activeRequests >= this.maxConcurrent) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < this.minIntervalMs) {
        await this.sleep(this.minIntervalMs - timeSinceLastRequest);
      }

      const task = this.queue.shift();
      if (task) {
        this.activeRequests++;
        this.lastRequestTime = Date.now();

        task().finally(() => {
          this.activeRequests--;
          this.processQueue();
        });
      }
    }

    this.processing = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Market with additional computed fields
 */
export interface Market {
  id: string;
  slug: string;
  title: string;
  description: string;
  endDate: Date;
  volume24h: number;
  liquidity: number;
  outcomes: Array<{
    name: string;
    price: number;
    tokenId: string;
  }>;
}

/**
 * Trade with normalized fields
 */
export interface Trade {
  size: number;
  price: number;
  side: "BUY" | "SELL";
  outcome: string;
  timestamp: Date;
  traderName: string | undefined;
}

/**
 * Unified Polymarket API Client
 *
 * Combines Gamma API (markets) and CLOB API (trades) into a single interface.
 */
export class PolymarketClient {
  private readonly gammaClient: GammaApiClient;
  private readonly clobClient: ClobApiClient;
  private readonly rateLimiter: RateLimiter;
  private readonly debug: boolean;

  constructor(options: ApiClientOptions = {}) {
    this.gammaClient = new GammaApiClient(options);
    this.clobClient = new ClobApiClient(options);
    this.rateLimiter = new RateLimiter(
      options.requestsPerSecond ?? 5,
      options.maxConcurrent ?? 3
    );
    this.debug = options.debug ?? false;
  }

  /**
   * Get all active markets
   */
  async getActiveMarkets(): Promise<Market[]> {
    return this.rateLimiter.execute(async () => {
      const markets = await this.gammaClient.getMarkets({ active: true, closed: false });
      return markets.map((m) => this.normalizeGammaMarket(m));
    });
  }

  /**
   * Get a specific market by ID
   */
  async getMarketById(id: string): Promise<Market | null> {
    return this.rateLimiter.execute(async () => {
      const market = await this.gammaClient.getMarketById(id);
      return market ? this.normalizeGammaMarket(market) : null;
    });
  }

  /**
   * Get markets closing today
   */
  async getMarketsClosingToday(): Promise<Market[]> {
    return this.rateLimiter.execute(async () => {
      const markets = await this.gammaClient.getMarketsClosingSoon(24);
      return markets.map((m) => this.normalizeGammaMarket(m));
    });
  }

  /**
   * Get recent trades for a market
   */
  async getRecentTrades(marketId: string, limit: number = 100): Promise<Trade[]> {
    return this.rateLimiter.execute(async () => {
      const result = await this.clobClient.getTrades({ market: marketId, limit });
      return result.trades.map((t) => this.normalizeClobTrade(t));
    });
  }

  /**
   * Get large trades for a market (>$50k by default)
   */
  async getLargeTrades(marketId: string, minSize: number = 50000): Promise<Trade[]> {
    return this.rateLimiter.execute(async () => {
      const result = await this.clobClient.getTrades({ market: marketId });
      return result.trades
        .filter((t) => t.size >= minSize)
        .map((t) => this.normalizeClobTrade(t));
    });
  }

  /**
   * Get open interest for a token
   */
  async getOpenInterest(tokenId: string): Promise<number> {
    return this.rateLimiter.execute(async () => {
      const oi = await this.clobClient.getOpenInterest(tokenId);
      return oi?.oi ?? 0;
    });
  }

  /**
   * Convert Gamma market to API contract format
   */
  private normalizeGammaMarket(m: import("./types.js").GammaMarket): Market {
    const outcomes = m.outcomes?.map((o) => o.title) ?? [];
    const outcomePrices = m.outcomePrices ?? m.outcomes?.map((o) => o.price) ?? [];
    const tokenIds = m.clobTokenIds ?? [];

    return {
      id: m.id,
      slug: m.slug,
      title: m.question,
      description: m.question,
      endDate: m.endDate ? new Date(m.endDate) : new Date(),
      volume24h: m.volume,
      liquidity: m.liquidity,
      outcomes: outcomes.map((name, index) => ({
        name,
        price: outcomePrices[index] ?? 0,
        tokenId: tokenIds[index] ?? "",
      })),
    };
  }

  /**
   * Convert CLOB trade to API contract format
   */
  private normalizeClobTrade(t: import("./types.js").ClobTrade): Trade {
    return {
      size: t.size,
      price: t.price,
      side: t.side,
      outcome: t.outcome ?? "Unknown",
      timestamp: new Date(t.match_time),
      traderName: t.maker_address ?? t.owner ?? undefined,
    };
  }
}
