import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";

// Create mock functions for Redis methods
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockQuit = vi.fn().mockResolvedValue(undefined);
const mockPing = vi.fn().mockResolvedValue("PONG");
const mockGet = vi.fn();
const mockSet = vi.fn().mockResolvedValue("OK");
const mockDel = vi.fn().mockResolvedValue(1);
const mockHset = vi.fn().mockResolvedValue(1);
const mockHgetall = vi.fn();
const mockSadd = vi.fn().mockResolvedValue(1);
const mockSrem = vi.fn().mockResolvedValue(1);
const mockSmembers = vi.fn();
const mockScard = vi.fn().mockResolvedValue(0);
const mockZadd = vi.fn().mockResolvedValue(1);
const mockZrevrange = vi.fn();
const mockZrangebyscore = vi.fn();
const mockZremrangebyscore = vi.fn().mockResolvedValue(0);
const mockExpire = vi.fn().mockResolvedValue(1);
const mockExists = vi.fn();
const mockKeys = vi.fn().mockResolvedValue([]);
const mockOn = vi.fn();

const mockPipeline = vi.fn().mockReturnValue({
  del: vi.fn().mockReturnThis(),
  sadd: vi.fn().mockReturnThis(),
  srem: vi.fn().mockReturnThis(),
  hset: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: vi.fn().mockResolvedValue([]),
});

// Mock ioredis module with a class
vi.mock("ioredis", () => {
  return {
    Redis: class MockRedis {
      connect = mockConnect;
      quit = mockQuit;
      ping = mockPing;
      get = mockGet;
      set = mockSet;
      del = mockDel;
      hset = mockHset;
      hgetall = mockHgetall;
      sadd = mockSadd;
      srem = mockSrem;
      smembers = mockSmembers;
      scard = mockScard;
      zadd = mockZadd;
      zrevrange = mockZrevrange;
      zrangebyscore = mockZrangebyscore;
      zremrangebyscore = mockZremrangebyscore;
      expire = mockExpire;
      exists = mockExists;
      keys = mockKeys;
      pipeline = mockPipeline;
      on = mockOn;
    },
  };
});

// Import after mock is set up
import { MarketCache } from "./redis.js";

describe("MarketCache", () => {
  let cache: MarketCache;

  const sampleMarket: NormalizedMarket = {
    id: "market-1",
    question: "Will X happen?",
    slug: "will-x-happen",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.65, 0.35],
    volume: 100000,
    liquidity: 50000,
    endDate: new Date("2024-12-31T23:59:59Z"),
    active: true,
    closed: false,
    tokenIds: ["token-yes", "token-no"],
  };

  const sampleTrade: NormalizedTrade = {
    id: "trade-1",
    marketId: "market-1",
    tokenId: "token-yes",
    side: "BUY",
    size: 75000,
    price: 0.65,
    timestamp: new Date("2024-01-15T10:30:00Z"),
    outcome: "Yes",
    traderAddress: "0x1234",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new MarketCache("redis://localhost:6379");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("healthCheck", () => {
    it("should return true when Redis is healthy", async () => {
      mockPing.mockResolvedValueOnce("PONG");
      const result = await cache.healthCheck();
      expect(result).toBe(true);
    });

    it("should return false when Redis is unhealthy", async () => {
      mockPing.mockRejectedValueOnce(new Error("Connection refused"));
      const result = await cache.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe("Topics Configuration", () => {
    it("should set and get topics config", async () => {
      const topics = ["politics", "crypto", "sports"];
      
      await cache.setTopicsConfig(topics);
      expect(mockSet).toHaveBeenCalledWith(
        "topics:config",
        JSON.stringify(topics),
        "EX",
        expect.any(Number)
      );

      mockGet.mockResolvedValueOnce(JSON.stringify(topics));
      const result = await cache.getTopicsConfig();
      expect(result).toEqual(topics);
    });

    it("should return empty array when no topics configured", async () => {
      mockGet.mockResolvedValueOnce(null);
      const result = await cache.getTopicsConfig();
      expect(result).toEqual([]);
    });
  });

  describe("Market Operations", () => {
    it("should set and get a market", async () => {
      await cache.setMarket(sampleMarket);
      expect(mockHset).toHaveBeenCalled();
      expect(mockExpire).toHaveBeenCalled();

      mockHgetall.mockResolvedValueOnce({
        id: "market-1",
        question: "Will X happen?",
        slug: "will-x-happen",
        outcomes: '["Yes","No"]',
        outcomePrices: "[0.65,0.35]",
        volume: "100000",
        liquidity: "50000",
        endDate: "2024-12-31T23:59:59.000Z",
        active: "true",
        closed: "false",
        tokenIds: '["token-yes","token-no"]',
      });

      const result = await cache.getMarket("market-1");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("market-1");
      expect(result?.outcomes).toEqual(["Yes", "No"]);
      expect(result?.outcomePrices).toEqual([0.65, 0.35]);
    });

    it("should return null for non-existent market", async () => {
      mockHgetall.mockResolvedValueOnce({});
      const result = await cache.getMarket("nonexistent");
      expect(result).toBeNull();
    });

    it("should get today market IDs", async () => {
      mockSmembers.mockResolvedValueOnce(["market-1", "market-2"]);
      const ids = await cache.getTodayMarketIds();
      expect(ids).toEqual(["market-1", "market-2"]);
    });
  });

  describe("Large Trades", () => {
    it("should add and retrieve large trades", async () => {
      await cache.addLargeTrade("market-1", sampleTrade);
      expect(mockZadd).toHaveBeenCalled();
      expect(mockExpire).toHaveBeenCalled();

      const serializedTrade = JSON.stringify({
        id: "trade-1",
        marketId: "market-1",
        tokenId: "token-yes",
        side: "BUY",
        size: "75000",
        price: "0.65",
        timestamp: "2024-01-15T10:30:00.000Z",
        outcome: "Yes",
        traderAddress: "0x1234",
      });

      mockZrevrange.mockResolvedValueOnce([serializedTrade]);

      const trades = await cache.getLargeTrades("market-1");
      expect(trades).toHaveLength(1);
      expect(trades[0]?.id).toBe("trade-1");
      expect(trades[0]?.size).toBe(75000);
    });

    it("should get trades since timestamp", async () => {
      const serializedTrade = JSON.stringify({
        id: "trade-1",
        marketId: "market-1",
        tokenId: "token-yes",
        side: "BUY",
        size: "75000",
        price: "0.65",
        timestamp: "2024-01-15T10:30:00.000Z",
        outcome: "Yes",
        traderAddress: "0x1234",
      });

      mockZrangebyscore.mockResolvedValueOnce([serializedTrade]);

      const since = new Date("2024-01-15T00:00:00Z");
      const trades = await cache.getLargeTradesSince("market-1", since);

      expect(trades).toHaveLength(1);
      expect(mockZrangebyscore).toHaveBeenCalledWith(
        "market:market-1:bets",
        since.getTime(),
        "+inf"
      );
    });
  });

  describe("Alert Deduplication", () => {
    it("should mark market as alerted", async () => {
      await cache.markAlerted("market-1");
      expect(mockSet).toHaveBeenCalledWith(
        "market:market-1:alerted",
        "1",
        "EX",
        expect.any(Number)
      );
    });

    it("should check if market was alerted", async () => {
      mockExists.mockResolvedValueOnce(1);
      const wasAlerted = await cache.wasAlerted("market-1");
      expect(wasAlerted).toBe(true);

      mockExists.mockResolvedValueOnce(0);
      const notAlerted = await cache.wasAlerted("market-2");
      expect(notAlerted).toBe(false);
    });

    it("should clear alert flag", async () => {
      await cache.clearAlerted("market-1");
      expect(mockDel).toHaveBeenCalledWith("market:market-1:alerted");
    });
  });

  describe("getStats", () => {
    it("should return cache stats", async () => {
      mockScard.mockResolvedValueOnce(5);
      mockPing.mockResolvedValueOnce("PONG");

      const stats = await cache.getStats();

      expect(stats.todayMarketsCount).toBe(5);
      expect(stats.healthy).toBe(true);
    });
  });
});
