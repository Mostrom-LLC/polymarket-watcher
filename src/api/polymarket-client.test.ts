import { describe, it, expect, vi, beforeEach } from "vitest";
import { PolymarketClient } from "./polymarket-client.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("PolymarketClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getActiveMarkets", () => {
    it("should return normalized markets", async () => {
      const mockResponse = [
        {
          id: "market-1",
          question: "Test Market?",
          conditionId: "cond-1",
          slug: "test-market",
          liquidity: "10000",
          volume: "50000",
          active: true,
          closed: false,
          outcomePrices: ["0.6", "0.4"],
          clobTokenIds: ["token-1", "token-2"],
          outcomes: [
            { id: "1", title: "Yes", price: "0.6" },
            { id: "2", title: "No", price: "0.4" },
          ],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new PolymarketClient();
      const markets = await client.getActiveMarkets();

      expect(markets).toHaveLength(1);
      expect(markets[0].id).toBe("market-1");
      expect(markets[0].title).toBe("Test Market?");
      expect(markets[0].volume24h).toBe(50000);
      expect(markets[0].outcomes).toHaveLength(2);
    });
  });

  describe("getMarketsClosingToday", () => {
    it("should return markets closing within 24 hours", async () => {
      const tomorrow = new Date();
      tomorrow.setHours(tomorrow.getHours() + 12);

      const mockResponse = [
        {
          id: "market-closing",
          question: "Closing Soon?",
          conditionId: "cond-2",
          slug: "closing-soon",
          liquidity: "5000",
          volume: "20000",
          active: true,
          closed: false,
          endDate: tomorrow.toISOString(),
          outcomePrices: ["0.5", "0.5"],
          clobTokenIds: ["token-3", "token-4"],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new PolymarketClient();
      const markets = await client.getMarketsClosingToday();

      expect(markets).toHaveLength(1);
      expect(markets[0].id).toBe("market-closing");
    });
  });

  describe("getRecentTrades", () => {
    it("should return normalized trades", async () => {
      const mockResponse = {
        data: [
          {
            id: "trade-1",
            taker_order_id: "order-1",
            market: "market-1",
            asset_id: "token-1",
            side: "BUY",
            size: "100",
            price: "0.65",
            fee_rate_bps: "0",
            status: "MATCHED",
            match_time: new Date().toISOString(),
            outcome: "Yes",
            maker_address: "0x123",
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new PolymarketClient();
      const trades = await client.getRecentTrades("market-1");

      expect(trades).toHaveLength(1);
      expect(trades[0].size).toBe(100);
      expect(trades[0].side).toBe("BUY");
    });
  });

  describe("getLargeTrades", () => {
    it("should filter trades by minimum size", async () => {
      const mockResponse = {
        data: [
          {
            id: "whale-trade",
            taker_order_id: "order-1",
            market: "market-1",
            asset_id: "token-1",
            side: "BUY",
            size: "75000",
            price: "0.7",
            fee_rate_bps: "0",
            status: "MATCHED",
            match_time: new Date().toISOString(),
            outcome: "Yes",
            maker_address: "0xwhale",
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new PolymarketClient();
      const trades = await client.getLargeTrades("market-1", 50000);

      expect(trades).toHaveLength(1);
      expect(trades[0].size).toBe(75000);
    });
  });

  describe("getOpenInterest", () => {
    it("should return open interest value", async () => {
      const mockResponse = {
        market: "market-1",
        asset_id: "token-1",
        oi: "1000000",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new PolymarketClient();
      const oi = await client.getOpenInterest("token-1");

      expect(oi).toBe(1000000);
    });
  });

  describe("rate limiting", () => {
    it("should queue requests to avoid rate limits", async () => {
      const mockResponse = [
        {
          id: "market-1",
          question: "Test?",
          conditionId: "c1",
          slug: "test",
          liquidity: "1000",
          volume: "5000",
          active: true,
          closed: false,
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new PolymarketClient({ requestsPerSecond: 10 });

      // Fire multiple requests concurrently
      const promises = [
        client.getActiveMarkets(),
        client.getActiveMarkets(),
        client.getActiveMarkets(),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("getMarketById", () => {
    it("should return specific market by ID", async () => {
      // getMarketById calls GammaClient.getMarketById which returns a single market
      const mockResponse = {
        id: "market-2",
        question: "Second Market?",
        conditionId: "c2",
        slug: "second",
        liquidity: "2000",
        volume: "10000",
        active: true,
        closed: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new PolymarketClient();
      const market = await client.getMarketById("market-2");

      expect(market).not.toBeNull();
      expect(market?.id).toBe("market-2");
      expect(market?.title).toBe("Second Market?");
    });

    it("should return null for non-existent market", async () => {
      // Return error that fails all retries (4 times: initial + 3 retries)
      mockFetch.mockRejectedValue(new Error("Not Found"));

      const client = new PolymarketClient({ retries: 0 });
      const market = await client.getMarketById("non-existent");

      expect(market).toBeNull();
    });
  });
});
