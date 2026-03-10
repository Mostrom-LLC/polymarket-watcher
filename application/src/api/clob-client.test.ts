import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClobApiClient } from "./clob-client.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("ClobApiClient", () => {
  let client: ClobApiClient;

  beforeEach(() => {
    client = new ClobApiClient({ retries: 0, timeout: 5000 });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getTrades", () => {
    it("should fetch and parse trades", async () => {
      const mockResponse = {
        data: [
          {
            id: "trade-1",
            taker_order_id: "order-1",
            market: "market-1",
            asset_id: "token-yes",
            side: "BUY",
            size: "10000",
            fee_rate_bps: "0",
            price: "0.65",
            status: "MATCHED",
            match_time: "2024-01-15T10:30:00Z",
          },
        ],
        next_cursor: "cursor-2",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.getTrades({ market: "market-1" });

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0]?.id).toBe("trade-1");
      expect(result.trades[0]?.size).toBe(10000);
      expect(result.trades[0]?.price).toBe(0.65);
      expect(result.nextCursor).toBe("cursor-2");
    });

    it("should handle empty response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      const result = await client.getTrades();

      expect(result.trades).toHaveLength(0);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  describe("getTradesByToken", () => {
    it("should fetch trades for a specific token", async () => {
      const mockResponse = {
        data: [
          {
            id: "trade-1",
            taker_order_id: "order-1",
            market: "market-1",
            asset_id: "token-yes",
            side: "BUY",
            size: "5000",
            fee_rate_bps: "0",
            price: "0.70",
            status: "MATCHED",
            match_time: "2024-01-15T11:00:00Z",
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.getTradesByToken("token-yes");

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0]?.asset_id).toBe("token-yes");
    });
  });

  describe("getLargeTrades", () => {
    it("should filter trades by minimum size", async () => {
      const mockResponse = {
        data: [
          {
            id: "trade-large",
            taker_order_id: "order-1",
            market: "market-1",
            asset_id: "token-yes",
            side: "BUY",
            size: "100000",
            fee_rate_bps: "0",
            price: "0.60",
            status: "MATCHED",
            match_time: "2024-01-15T12:00:00Z",
          },
          {
            id: "trade-small",
            taker_order_id: "order-2",
            market: "market-1",
            asset_id: "token-yes",
            side: "SELL",
            size: "1000",
            fee_rate_bps: "0",
            price: "0.55",
            status: "MATCHED",
            match_time: "2024-01-15T12:01:00Z",
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const largeTrades = await client.getLargeTrades("token-yes", 50000);

      expect(largeTrades).toHaveLength(1);
      expect(largeTrades[0]?.id).toBe("trade-large");
      expect(largeTrades[0]?.size).toBe(100000);
    });
  });

  describe("getOpenInterest", () => {
    it("should fetch open interest for a token", async () => {
      const mockOI = {
        market: "market-1",
        asset_id: "token-yes",
        oi: "500000",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockOI),
      });

      const oi = await client.getOpenInterest("token-yes");

      expect(oi).not.toBeNull();
      expect(oi?.oi).toBe(500000);
    });

    it("should return null on error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const oi = await client.getOpenInterest("nonexistent");

      expect(oi).toBeNull();
    });
  });

  describe("getMultipleOpenInterest", () => {
    it("should fetch OI for multiple tokens", async () => {
      const mockOI1 = { market: "m1", asset_id: "token-1", oi: "100000" };
      const mockOI2 = { market: "m2", asset_id: "token-2", oi: "200000" };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockOI1),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockOI2),
        });

      const results = await client.getMultipleOpenInterest(["token-1", "token-2"]);

      expect(results.size).toBe(2);
      expect(results.get("token-1")).toBe(100000);
      expect(results.get("token-2")).toBe(200000);
    });
  });

  describe("normalizeTrade", () => {
    it("should normalize trade to unified format", () => {
      const clobTrade = {
        id: "trade-1",
        taker_order_id: "order-1",
        market: "market-1",
        asset_id: "token-yes",
        side: "BUY" as const,
        size: 50000,
        fee_rate_bps: 0,
        price: 0.65,
        status: "MATCHED",
        match_time: "2024-01-15T10:30:00Z",
        outcome: "Yes",
        owner: "0x1234",
      };

      const normalized = client.normalizeTrade(clobTrade);

      expect(normalized.id).toBe("trade-1");
      expect(normalized.marketId).toBe("market-1");
      expect(normalized.tokenId).toBe("token-yes");
      expect(normalized.side).toBe("BUY");
      expect(normalized.size).toBe(50000);
      expect(normalized.price).toBe(0.65);
      expect(normalized.timestamp).toBeInstanceOf(Date);
      expect(normalized.outcome).toBe("Yes");
      expect(normalized.traderAddress).toBe("0x1234");
    });
  });

  describe("calculateTradeValue", () => {
    it("should calculate trade value in USD", () => {
      const trade = {
        id: "t1",
        marketId: "m1",
        tokenId: "token-1",
        side: "BUY" as const,
        size: 10000,
        price: 0.75,
        timestamp: new Date(),
        outcome: null,
        traderAddress: null,
      };

      const value = client.calculateTradeValue(trade);

      expect(value).toBe(7500);
    });
  });
});
