import {
  clobTradeSchema,
  clobOpenInterestSchema,
  clobPaginatedResponseSchema,
  type ClobTrade,
  type ClobOpenInterest,
  type NormalizedTrade,
  type ApiClientOptions,
} from "./types.js";
import { z } from "zod";

/**
 * CLOB/Data API Client
 * 
 * Client for Polymarket's CLOB and Data APIs (trade data, open interest).
 * Docs: https://docs.polymarket.com/
 */
export class ClobApiClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly retries: number;
  private readonly retryDelay: number;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://data-api.polymarket.com";
    this.timeout = options.timeout ?? 10000;
    this.retries = options.retries ?? 3;
    this.retryDelay = options.retryDelay ?? 1000;
  }

  /**
   * Fetch with retry logic
   */
  private async fetchWithRetry<T>(
    url: string,
    parseResponse: (data: unknown) => T
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "Accept": "application/json",
            "User-Agent": "polymarket-watcher/0.1.0",
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return parseResponse(data);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < this.retries) {
          await new Promise((resolve) => 
            setTimeout(resolve, this.retryDelay * (attempt + 1))
          );
        }
      }
    }

    throw new Error(`Failed after ${this.retries + 1} attempts: ${lastError?.message}`);
  }

  /**
   * Get trades for a market
   */
  async getTrades(params: {
    market?: string;
    maker?: string;
    taker?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<{ trades: ClobTrade[]; nextCursor: string | undefined }> {
    const searchParams = new URLSearchParams();
    
    if (params.market) {
      searchParams.set("market", params.market);
    }
    if (params.maker) {
      searchParams.set("maker", params.maker);
    }
    if (params.taker) {
      searchParams.set("taker", params.taker);
    }
    if (params.limit !== undefined) {
      searchParams.set("limit", String(params.limit));
    }
    if (params.cursor) {
      searchParams.set("cursor", params.cursor);
    }

    const queryString = searchParams.toString();
    const url = `${this.baseUrl}/trades${queryString ? `?${queryString}` : ""}`;

    const result = await this.fetchWithRetry(url, (data) => this.parseTradeResponse(data));

    return {
      trades: result.data,
      nextCursor: result.next_cursor,
    };
  }

  /**
   * Get trades by token ID (asset ID)
   */
  async getTradesByToken(
    tokenId: string,
    options: { limit?: number; cursor?: string | undefined } = {}
  ): Promise<{ trades: ClobTrade[]; nextCursor: string | undefined }> {
    const searchParams = new URLSearchParams();
    searchParams.set("asset_id", tokenId);
    
    if (options.limit !== undefined) {
      searchParams.set("limit", String(options.limit));
    }
    if (options.cursor) {
      searchParams.set("cursor", options.cursor);
    }

    const url = `${this.baseUrl}/trades?${searchParams.toString()}`;

    const result = await this.fetchWithRetry(url, (data) => this.parseTradeResponse(data));

    return {
      trades: result.data,
      nextCursor: result.next_cursor,
    };
  }

  /**
   * Get large trades (whale detection)
   */
  async getLargeTrades(
    tokenId: string,
    minSize: number = 50000,
    options: { limit?: number } = {}
  ): Promise<ClobTrade[]> {
    const allTrades: ClobTrade[] = [];
    let cursor: string | undefined;
    const maxIterations = 10; // Safety limit
    let iterations = 0;

    while (iterations < maxIterations) {
      const result = await this.getTradesByToken(tokenId, {
        limit: options.limit ?? 100,
        cursor,
      });
      const { trades, nextCursor } = result;

      const largeTrades = trades.filter((trade) => trade.size >= minSize);
      allTrades.push(...largeTrades);

      if (!nextCursor || trades.length === 0) {
        break;
      }

      cursor = nextCursor;
      iterations++;
    }

    return allTrades;
  }

  /**
   * Get open interest for a market
   */
  async getOpenInterest(tokenId: string): Promise<ClobOpenInterest | null> {
    const url = `${this.baseUrl}/oi?market=${encodeURIComponent(tokenId)}`;

    try {
      return await this.fetchWithRetry(url, (data) => {
        return clobOpenInterestSchema.parse(data);
      });
    } catch {
      return null;
    }
  }

  /**
   * Get open interest for multiple tokens
   */
  async getMultipleOpenInterest(tokenIds: string[]): Promise<Map<string, number>> {
    const results = new Map<string, number>();

    await Promise.all(
      tokenIds.map(async (tokenId) => {
        const oi = await this.getOpenInterest(tokenId);
        if (oi) {
          results.set(tokenId, oi.oi);
        }
      })
    );

    return results;
  }

  /**
   * Normalize a CLOB trade to unified format
   */
  normalizeTrade(trade: ClobTrade, marketId?: string): NormalizedTrade {
    const traderAddress = "maker_address" in trade
      ? trade.owner ?? trade.maker_address ?? null
      : trade.owner ?? null;

    return {
      id: trade.id,
      marketId: marketId ?? trade.market,
      tokenId: trade.asset_id,
      side: trade.side,
      size: trade.size,
      price: trade.price,
      timestamp: new Date(trade.match_time),
      outcome: trade.outcome ?? null,
      traderAddress,
    };
  }

  /**
   * Calculate trade value in USD
   */
  calculateTradeValue(trade: ClobTrade | NormalizedTrade): number {
    return trade.size * trade.price;
  }

  private parseTradeResponse(data: unknown): { data: ClobTrade[]; next_cursor: string | undefined } {
    const schema = z.union([
      clobPaginatedResponseSchema(clobTradeSchema).transform((response) => ({
        data: response.data,
        next_cursor: response.next_cursor,
      })),
      z.array(clobTradeSchema).transform((trades) => ({ data: trades, next_cursor: undefined as string | undefined })),
    ]);

    return schema.parse(data);
  }
}
