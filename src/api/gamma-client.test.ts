import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GammaApiClient } from "./gamma-client.js";
import { gammaMarketSchema } from "./types.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("GammaApiClient", () => {
  let client: GammaApiClient;

  beforeEach(() => {
    client = new GammaApiClient({ retries: 0, timeout: 5000 });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getMarkets", () => {
    it("should fetch and parse markets", async () => {
      const mockMarkets = [
        {
          id: "market-1",
          question: "Will X happen?",
          conditionId: "cond-1",
          slug: "will-x-happen",
          liquidity: "100000",
          volume: "500000",
          active: true,
          closed: false,
          clobTokenIds: ["token-yes", "token-no"],
          outcomePrices: ["0.65", "0.35"],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMarkets),
      });

      const markets = await client.getMarkets({ active: true });

      expect(markets).toHaveLength(1);
      expect(markets[0]?.id).toBe("market-1");
      expect(markets[0]?.liquidity).toBe(100000);
      expect(markets[0]?.volume).toBe(500000);
      expect(markets[0]?.outcomePrices).toEqual([0.65, 0.35]);
    });

    it("should handle empty response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const markets = await client.getMarkets();

      expect(markets).toHaveLength(0);
    });

    it("should throw on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(client.getMarkets()).rejects.toThrow("HTTP 500");
    });
  });

  describe("getMarketBySlug", () => {
    it("should return market when found", async () => {
      const mockMarkets = [
        {
          id: "market-1",
          question: "Test Market",
          conditionId: "cond-1",
          slug: "test-market",
          liquidity: "50000",
          volume: "200000",
          active: true,
          closed: false,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMarkets),
      });

      const market = await client.getMarketBySlug("test-market");

      expect(market).not.toBeNull();
      expect(market?.slug).toBe("test-market");
    });

    it("should return null when not found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const market = await client.getMarketBySlug("nonexistent");

      expect(market).toBeNull();
    });
  });

  describe("getEvents", () => {
    it("should fetch and parse events", async () => {
      const mockEvents = [
        {
          id: "event-1",
          title: "2024 Election",
          slug: "2024-election",
          volume: "10000000",
          liquidity: "5000000",
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEvents),
      });

      const events = await client.getEvents();

      expect(events).toHaveLength(1);
      expect(events[0]?.title).toBe("2024 Election");
      expect(events[0]?.volume).toBe(10000000);
    });
  });

  describe("getMarketsClosingSoon", () => {
    it("should filter markets by end date", async () => {
      const now = new Date();
      const in12Hours = new Date(now.getTime() + 12 * 60 * 60 * 1000);
      const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);

      const mockMarkets = [
        {
          id: "market-soon",
          question: "Closing soon",
          conditionId: "cond-1",
          slug: "closing-soon",
          liquidity: "10000",
          volume: "50000",
          active: true,
          closed: false,
          endDate: in12Hours.toISOString(),
        },
        {
          id: "market-later",
          question: "Closing later",
          conditionId: "cond-2",
          slug: "closing-later",
          liquidity: "10000",
          volume: "50000",
          active: true,
          closed: false,
          endDate: in48Hours.toISOString(),
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMarkets),
      });

      const markets = await client.getMarketsClosingSoon(24);

      expect(markets).toHaveLength(1);
      expect(markets[0]?.id).toBe("market-soon");
    });
  });

  describe("normalizeMarket", () => {
    it("should normalize market with JSON string fields (actual API format)", () => {
      // This matches the actual Gamma API response format
      const rawMarket = {
        id: "market-1",
        question: "Will X happen?",
        conditionId: "cond-1",
        slug: "will-x-happen",
        liquidity: "100000",
        volume: "500000",
        active: true,
        closed: false,
        endDate: "2024-12-31T23:59:59Z",
        clobTokenIds: '["token-yes","token-no"]',
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.65","0.35"]',
      };

      // Parse through schema first (as the client does)
      const gammaMarket = gammaMarketSchema.parse(rawMarket);
      const normalized = client.normalizeMarket(gammaMarket);

      expect(normalized.id).toBe("market-1");
      expect(normalized.outcomes).toEqual(["Yes", "No"]);
      expect(normalized.outcomePrices).toEqual([0.65, 0.35]);
      expect(normalized.tokenIds).toEqual(["token-yes", "token-no"]);
      expect(normalized.endDate).toBeInstanceOf(Date);
    });

    it("should normalize market with array of outcome objects (legacy format)", () => {
      // Some API responses may include full outcome objects
      const rawMarket = {
        id: "market-2",
        question: "Will Y happen?",
        conditionId: "cond-2",
        slug: "will-y-happen",
        liquidity: "200000",
        volume: "600000",
        active: true,
        closed: false,
        endDate: "2024-12-31T23:59:59Z",
        clobTokenIds: ["token-a", "token-b"],
        outcomes: [
          { id: "o1", title: "Yes", price: "0.70" },
          { id: "o2", title: "No", price: "0.30" },
        ],
        outcomePrices: ["0.70", "0.30"],
      };

      const gammaMarket = gammaMarketSchema.parse(rawMarket);
      const normalized = client.normalizeMarket(gammaMarket);

      expect(normalized.id).toBe("market-2");
      expect(normalized.outcomes).toEqual(["Yes", "No"]);
      expect(normalized.outcomePrices).toEqual([0.70, 0.30]);
      expect(normalized.tokenIds).toEqual(["token-a", "token-b"]);
    });
  });
});
