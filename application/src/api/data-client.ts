import {
  type ApiClientOptions,
  closedPositionSchema,
  dataActivitySchema,
  dataPositionSchema,
  marketHolderGroupSchema,
  type ClosedPosition,
  type DataActivity,
  type DataPosition,
  type MarketHolderGroup,
} from "./types.js";

interface DataClientQuery {
  [key: string]: string | number | readonly string[] | readonly number[] | undefined;
}

function appendQueryParam(searchParams: URLSearchParams, key: string, value: DataClientQuery[string]): void {
  if (value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return;
    }

    searchParams.set(key, value.join(","));
    return;
  }

  searchParams.set(key, String(value));
}

export class DataApiClient {
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

  private async fetchWithRetry<T>(path: string, parseResponse: (data: unknown) => T): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(`${this.baseUrl}${path}`, {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
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
          await new Promise((resolve) => setTimeout(resolve, this.retryDelay * (attempt + 1)));
        }
      }
    }

    throw new Error(`Failed after ${this.retries + 1} attempts: ${lastError?.message}`);
  }

  private buildPath(pathname: string, query: DataClientQuery): string {
    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(query)) {
      appendQueryParam(searchParams, key, value);
    }

    const queryString = searchParams.toString();
    return `${pathname}${queryString ? `?${queryString}` : ""}`;
  }

  async getUserActivity(params: {
    user: string;
    market?: readonly string[];
    limit?: number;
    offset?: number;
    side?: "BUY" | "SELL";
    type?: readonly string[];
    sortDirection?: "ASC" | "DESC";
  }): Promise<DataActivity[]> {
    const path = this.buildPath("/activity", {
      user: params.user,
      market: params.market,
      limit: params.limit,
      offset: params.offset,
      type: params.type,
      sortDirection: params.sortDirection,
      side: params.side,
    });

    return this.fetchWithRetry(path, (data) => dataActivitySchema.array().parse(data));
  }

  async getUserPositions(params: {
    user: string;
    eventId?: readonly number[];
    market?: readonly string[];
    limit?: number;
    offset?: number;
    sizeThreshold?: number;
    sortBy?: "CURRENT" | "PNL" | "VALUE";
  }): Promise<DataPosition[]> {
    const path = this.buildPath("/positions", {
      user: params.user,
      eventId: params.eventId,
      market: params.market,
      sizeThreshold: params.sizeThreshold,
      limit: params.limit,
      offset: params.offset,
      sortBy: params.sortBy,
    });

    return this.fetchWithRetry(path, (data) => dataPositionSchema.array().parse(data));
  }

  async getClosedPositions(params: {
    user: string;
    market?: readonly string[];
    limit?: number;
    offset?: number;
  }): Promise<ClosedPosition[]> {
    const path = this.buildPath("/closed-positions", {
      user: params.user,
      market: params.market,
      limit: params.limit,
      offset: params.offset,
    });

    return this.fetchWithRetry(path, (data) => closedPositionSchema.array().parse(data));
  }

  async getMarketHolders(params: {
    market: readonly string[];
    limit?: number;
    minBalance?: number;
  }): Promise<MarketHolderGroup[]> {
    const path = this.buildPath("/holders", {
      market: params.market,
      limit: params.limit,
      minBalance: params.minBalance,
    });

    return this.fetchWithRetry(path, (data) => marketHolderGroupSchema.array().parse(data));
  }
}
