import {
  gammaMarketSchema,
  gammaEventSchema,
  gammaListResponseSchema,
  type GammaMarket,
  type GammaEvent,
  type NormalizedMarket,
  type ApiClientOptions,
} from "./types.js";

/**
 * Gamma API Client
 * 
 * Client for Polymarket's Gamma API (market discovery).
 * Docs: https://docs.polymarket.com/
 */
export class GammaApiClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly retries: number;
  private readonly retryDelay: number;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://gamma-api.polymarket.com";
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
   * Get all markets
   */
  async getMarkets(params: {
    active?: boolean;
    closed?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<GammaMarket[]> {
    const searchParams = new URLSearchParams();
    
    if (params.active !== undefined) {
      searchParams.set("active", String(params.active));
    }
    if (params.closed !== undefined) {
      searchParams.set("closed", String(params.closed));
    }
    if (params.limit !== undefined) {
      searchParams.set("limit", String(params.limit));
    }
    if (params.offset !== undefined) {
      searchParams.set("offset", String(params.offset));
    }

    const queryString = searchParams.toString();
    const url = `${this.baseUrl}/markets${queryString ? `?${queryString}` : ""}`;

    return this.fetchWithRetry(url, (data) => {
      const schema = gammaListResponseSchema(gammaMarketSchema);
      return schema.parse(data);
    });
  }

  /**
   * Get a specific market by slug
   */
  async getMarketBySlug(slug: string): Promise<GammaMarket | null> {
    const url = `${this.baseUrl}/markets?slug=${encodeURIComponent(slug)}`;

    const markets = await this.fetchWithRetry(url, (data) => {
      const schema = gammaListResponseSchema(gammaMarketSchema);
      return schema.parse(data);
    });

    return markets[0] ?? null;
  }

  /**
   * Get a specific market by ID
   */
  async getMarketById(id: string): Promise<GammaMarket | null> {
    const url = `${this.baseUrl}/markets/${encodeURIComponent(id)}`;

    try {
      return await this.fetchWithRetry(url, (data) => {
        return gammaMarketSchema.parse(data);
      });
    } catch {
      return null;
    }
  }

  /**
   * Get all events
   */
  async getEvents(params: {
    limit?: number;
    offset?: number;
  } = {}): Promise<GammaEvent[]> {
    const searchParams = new URLSearchParams();
    
    if (params.limit !== undefined) {
      searchParams.set("limit", String(params.limit));
    }
    if (params.offset !== undefined) {
      searchParams.set("offset", String(params.offset));
    }

    const queryString = searchParams.toString();
    const url = `${this.baseUrl}/events${queryString ? `?${queryString}` : ""}`;

    return this.fetchWithRetry(url, (data) => {
      const schema = gammaListResponseSchema(gammaEventSchema);
      return schema.parse(data);
    });
  }

  /**
   * Get a specific event by slug
   */
  async getEventBySlug(slug: string): Promise<GammaEvent | null> {
    const url = `${this.baseUrl}/events?slug=${encodeURIComponent(slug)}`;

    const events = await this.fetchWithRetry(url, (data) => {
      const schema = gammaListResponseSchema(gammaEventSchema);
      return schema.parse(data);
    });

    return events[0] ?? null;
  }

  /**
   * Get markets closing within a time window
   */
  async getMarketsClosingSoon(hoursFromNow: number = 48): Promise<GammaMarket[]> {
    const markets = await this.getMarkets({ active: true, closed: false });
    const now = new Date();
    const cutoff = new Date(now.getTime() + hoursFromNow * 60 * 60 * 1000);

    return markets.filter((market) => {
      if (!market.endDate) return false;
      const endDate = new Date(market.endDate);
      return endDate >= now && endDate <= cutoff;
    });
  }

  /**
   * Normalize a Gamma market to unified format
   * 
   * The schema already normalizes outcomes to string[] and outcomePrices to number[],
   * so we just need to handle the optional fields.
   */
  normalizeMarket(market: GammaMarket): NormalizedMarket {
    return {
      id: market.id,
      question: market.question,
      slug: market.slug,
      outcomes: market.outcomes ?? [],
      outcomePrices: market.outcomePrices ?? [],
      volume: market.volume,
      liquidity: market.liquidity,
      endDate: market.endDate ? new Date(market.endDate) : null,
      active: market.active,
      closed: market.closed,
      tokenIds: market.clobTokenIds ?? [],
    };
  }
}
