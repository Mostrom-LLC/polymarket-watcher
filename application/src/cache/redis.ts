import { Redis } from "ioredis";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";
import type { ReplayLedgerSnapshot } from "../surveillance/replay-ledger.js";

/**
 * Redis key prefixes
 */
const KEYS = {
  TOPICS_CONFIG: "topics:config",
  MARKETS_TODAY: "markets:today",
  MARKET: (id: string) => `market:${id}`,
  MARKET_BETS: (id: string) => `market:${id}:bets`,
  MARKET_ALERTED: (id: string) => `market:${id}:alerted`,
  SURVEILLANCE_LEDGER: "surveillance:ledger",
} as const;

/**
 * Default TTL: 48 hours
 */
const DEFAULT_TTL_SECONDS = 48 * 60 * 60;

/**
 * Serialized market for Redis storage
 */
interface SerializedMarket {
  id: string;
  question: string;
  slug: string;
  outcomes: string;
  outcomePrices: string;
  volume: string;
  liquidity: string;
  endDate: string;
  active: string;
  closed: string;
  tokenIds: string;
}

/**
 * Serialized trade for Redis storage
 */
interface SerializedTrade {
  id: string;
  marketId: string;
  tokenId: string;
  side: string;
  size: string;
  price: string;
  timestamp: string;
  outcome: string;
  traderAddress: string;
}

/**
 * Market Cache Service
 * 
 * Redis-backed caching for Polymarket data.
 */
export class MarketCache {
  private client: Redis;
  private isConnected = false;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 500, 3000);
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    this.client.on("connect", () => {
      this.isConnected = true;
    });

    this.client.on("close", () => {
      this.isConnected = false;
    });

    this.client.on("error", (err) => {
      console.error("[MarketCache] Redis error:", err.message);
    });
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.client.connect();
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.quit();
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === "PONG";
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Topics Configuration
  // ===========================================================================

  /**
   * Set watched topics from config
   */
  async setTopicsConfig(topics: string[]): Promise<void> {
    await this.client.set(
      KEYS.TOPICS_CONFIG,
      JSON.stringify(topics),
      "EX",
      DEFAULT_TTL_SECONDS
    );
  }

  /**
   * Get watched topics
   */
  async getTopicsConfig(): Promise<string[]> {
    const data = await this.client.get(KEYS.TOPICS_CONFIG);
    if (!data) return [];
    return JSON.parse(data) as string[];
  }

  // ===========================================================================
  // Today's Markets
  // ===========================================================================

  /**
   * Set markets closing today
   */
  async setTodayMarkets(markets: NormalizedMarket[]): Promise<void> {
    const pipeline = this.client.pipeline();

    // Clear existing set
    pipeline.del(KEYS.MARKETS_TODAY);

    // Add all market IDs to set
    if (markets.length > 0) {
      const marketIds = markets.map((m) => m.id);
      pipeline.sadd(KEYS.MARKETS_TODAY, ...marketIds);
      pipeline.expire(KEYS.MARKETS_TODAY, DEFAULT_TTL_SECONDS);
    }

    // Store each market
    for (const market of markets) {
      await this.setMarketPipeline(pipeline, market);
    }

    await pipeline.exec();
  }

  /**
   * Get market IDs closing today
   */
  async getTodayMarketIds(): Promise<string[]> {
    return this.client.smembers(KEYS.MARKETS_TODAY);
  }

  /**
   * Get all markets closing today with full data
   */
  async getTodayMarkets(): Promise<NormalizedMarket[]> {
    const ids = await this.getTodayMarketIds();
    const markets: NormalizedMarket[] = [];

    for (const id of ids) {
      const market = await this.getMarket(id);
      if (market) {
        markets.push(market);
      }
    }

    return markets;
  }

  // ===========================================================================
  // Individual Market
  // ===========================================================================

  /**
   * Serialize market for Redis hash storage
   */
  private serializeMarket(market: NormalizedMarket): SerializedMarket {
    return {
      id: market.id,
      question: market.question,
      slug: market.slug,
      outcomes: JSON.stringify(market.outcomes),
      outcomePrices: JSON.stringify(market.outcomePrices),
      volume: String(market.volume),
      liquidity: String(market.liquidity),
      endDate: market.endDate?.toISOString() ?? "",
      active: String(market.active),
      closed: String(market.closed),
      tokenIds: JSON.stringify(market.tokenIds),
    };
  }

  /**
   * Deserialize market from Redis hash
   */
  private deserializeMarket(data: Record<string, string>): NormalizedMarket {
    return {
      id: data.id ?? "",
      question: data.question ?? "",
      slug: data.slug ?? "",
      outcomes: JSON.parse(data.outcomes ?? "[]") as string[],
      outcomePrices: JSON.parse(data.outcomePrices ?? "[]") as number[],
      volume: parseFloat(data.volume ?? "0"),
      liquidity: parseFloat(data.liquidity ?? "0"),
      endDate: data.endDate ? new Date(data.endDate) : null,
      active: data.active === "true",
      closed: data.closed === "true",
      tokenIds: JSON.parse(data.tokenIds ?? "[]") as string[],
    };
  }

  /**
   * Add market to pipeline (for batch operations)
   */
  private async setMarketPipeline(
    pipeline: ReturnType<Redis["pipeline"]>,
    market: NormalizedMarket
  ): Promise<void> {
    const key = KEYS.MARKET(market.id);
    const serialized = this.serializeMarket(market);
    pipeline.hset(key, serialized);
    pipeline.expire(key, DEFAULT_TTL_SECONDS);
  }

  /**
   * Set/update a market
   */
  async setMarket(market: NormalizedMarket): Promise<void> {
    const key = KEYS.MARKET(market.id);
    const serialized = this.serializeMarket(market);
    await this.client.hset(key, serialized);
    await this.client.expire(key, DEFAULT_TTL_SECONDS);
  }

  /**
   * Get a market by ID
   */
  async getMarket(id: string): Promise<NormalizedMarket | null> {
    const key = KEYS.MARKET(id);
    const data = await this.client.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return this.deserializeMarket(data);
  }

  /**
   * Delete a market
   */
  async deleteMarket(id: string): Promise<void> {
    const pipeline = this.client.pipeline();
    pipeline.del(KEYS.MARKET(id));
    pipeline.del(KEYS.MARKET_BETS(id));
    pipeline.del(KEYS.MARKET_ALERTED(id));
    pipeline.srem(KEYS.MARKETS_TODAY, id);
    await pipeline.exec();
  }

  // ===========================================================================
  // Large Trades (Whale Detection)
  // ===========================================================================

  /**
   * Serialize trade for Redis sorted set storage
   */
  private serializeTrade(trade: NormalizedTrade): string {
    const serialized: SerializedTrade = {
      id: trade.id,
      marketId: trade.marketId,
      tokenId: trade.tokenId,
      side: trade.side,
      size: String(trade.size),
      price: String(trade.price),
      timestamp: trade.timestamp.toISOString(),
      outcome: trade.outcome ?? "",
      traderAddress: trade.traderAddress ?? "",
    };
    return JSON.stringify(serialized);
  }

  /**
   * Deserialize trade from Redis
   */
  private deserializeTrade(data: string): NormalizedTrade {
    const parsed = JSON.parse(data) as SerializedTrade;
    return {
      id: parsed.id,
      marketId: parsed.marketId,
      tokenId: parsed.tokenId,
      side: parsed.side as "BUY" | "SELL",
      size: parseFloat(parsed.size),
      price: parseFloat(parsed.price),
      timestamp: new Date(parsed.timestamp),
      outcome: parsed.outcome || null,
      traderAddress: parsed.traderAddress || null,
    };
  }

  /**
   * Add a large trade (for whale detection)
   */
  async addLargeTrade(marketId: string, trade: NormalizedTrade): Promise<void> {
    const key = KEYS.MARKET_BETS(marketId);
    const score = trade.timestamp.getTime();
    const member = this.serializeTrade(trade);

    await this.client.zadd(key, score, member);
    await this.client.expire(key, DEFAULT_TTL_SECONDS);
  }

  /**
   * Get large trades for a market (sorted by timestamp, most recent first)
   */
  async getLargeTrades(
    marketId: string,
    limit: number = 50
  ): Promise<NormalizedTrade[]> {
    const key = KEYS.MARKET_BETS(marketId);
    const data = await this.client.zrevrange(key, 0, limit - 1);

    return data.map((item) => this.deserializeTrade(item));
  }

  /**
   * Get large trades since a timestamp
   */
  async getLargeTradesSince(
    marketId: string,
    since: Date
  ): Promise<NormalizedTrade[]> {
    const key = KEYS.MARKET_BETS(marketId);
    const data = await this.client.zrangebyscore(
      key,
      since.getTime(),
      "+inf"
    );

    return data.map((item) => this.deserializeTrade(item));
  }

  /**
   * Clear old trades (older than 48 hours)
   */
  async clearOldTrades(marketId: string): Promise<number> {
    const key = KEYS.MARKET_BETS(marketId);
    const cutoff = Date.now() - DEFAULT_TTL_SECONDS * 1000;
    return this.client.zremrangebyscore(key, "-inf", cutoff);
  }

  // ===========================================================================
  // Alert Deduplication
  // ===========================================================================

  /**
   * Mark a market as alerted (30-min alert sent)
   */
  async markAlerted(marketId: string, ttlSeconds: number = 3600): Promise<void> {
    const key = KEYS.MARKET_ALERTED(marketId);
    await this.client.set(key, "1", "EX", ttlSeconds);
  }

  /**
   * Check if market was already alerted
   */
  async wasAlerted(marketId: string): Promise<boolean> {
    const key = KEYS.MARKET_ALERTED(marketId);
    const exists = await this.client.exists(key);
    return exists === 1;
  }

  /**
   * Clear alert flag (allow re-alerting)
   */
  async clearAlerted(marketId: string): Promise<void> {
    const key = KEYS.MARKET_ALERTED(marketId);
    await this.client.del(key);
  }

  async setSurveillanceLedgerSnapshot(snapshot: ReplayLedgerSnapshot): Promise<void> {
    await this.client.set(
      KEYS.SURVEILLANCE_LEDGER,
      JSON.stringify(snapshot),
      "EX",
      DEFAULT_TTL_SECONDS
    );
  }

  async getSurveillanceLedgerSnapshot(): Promise<ReplayLedgerSnapshot> {
    const data = await this.client.get(KEYS.SURVEILLANCE_LEDGER);
    if (!data) {
      return { entries: [] };
    }

    return JSON.parse(data) as ReplayLedgerSnapshot;
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get cache stats
   */
  async getStats(): Promise<{
    todayMarketsCount: number;
    healthy: boolean;
  }> {
    const [todayCount, healthy] = await Promise.all([
      this.client.scard(KEYS.MARKETS_TODAY),
      this.healthCheck(),
    ]);

    return {
      todayMarketsCount: todayCount,
      healthy,
    };
  }

  /**
   * Clear all data (use with caution!)
   */
  async clearAll(): Promise<void> {
    const keys = await this.client.keys("*");
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }
}

const sharedCachesByUrl = new Map<string, MarketCache>();

export function getMarketCache(redisUrl: string): MarketCache {
  const existingCache = sharedCachesByUrl.get(redisUrl);
  if (existingCache) {
    return existingCache;
  }

  const cache = new MarketCache(redisUrl);
  sharedCachesByUrl.set(redisUrl, cache);
  return cache;
}
