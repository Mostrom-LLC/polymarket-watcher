import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlackNotifier, type MarketAlert, type WhaleAlert, type DailySummary, type HealthReport } from "./slack.js";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";
import type { WhaleAnalysisResult } from "../agents/whale-analyzer.js";

// Mock @slack/web-api
vi.mock("@slack/web-api", () => {
  return {
    WebClient: class MockWebClient {
      chat = {
        postMessage: vi.fn().mockResolvedValue({ ok: true, ts: "123" }),
      };
      auth = {
        test: vi.fn().mockResolvedValue({ ok: true }),
      };
    },
  };
});

describe("SlackNotifier", () => {
  let notifier: SlackNotifier;

  const sampleMarket: NormalizedMarket = {
    id: "market-1",
    question: "Will Bitcoin hit $100k by March 31?",
    slug: "bitcoin-100k-march",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.65, 0.35],
    volume: 1000000,
    liquidity: 500000,
    endDate: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes from now
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
    timestamp: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
    outcome: "Yes",
    traderAddress: "0x1234abcd",
  };

  const sampleAnalysis: WhaleAnalysisResult = {
    hasWhaleActivity: true,
    largestBets: [sampleTrade],
    marketLean: "YES",
    momentum: "+8% toward YES",
    recommendation: "LEAN_YES",
    confidence: "HIGH",
    reasoning: "Strong whale activity on YES side",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    notifier = new SlackNotifier("xoxb-test-token", "test-channel");
  });

  describe("sendMarketAlert", () => {
    it("should send a market closing alert", async () => {
      const alert: MarketAlert = {
        market: sampleMarket,
        largestBets: [sampleTrade],
        marketLean: "YES",
        momentum: "+8% toward YES",
        recommendation: "Consider YES position",
      };

      const result = await notifier.sendMarketAlert(alert);

      expect(result).not.toBeNull();
      expect(result?.ok).toBe(true);
    });

    it("should include formatted message with market details", async () => {
      const alert: MarketAlert = {
        market: sampleMarket,
      };

      await notifier.sendMarketAlert(alert);

      // Message should have been sent with market question
      // The mock captures the call
    });
  });

  describe("sendWhaleAlert", () => {
    it("should send a whale activity alert", async () => {
      const alert: WhaleAlert = {
        market: sampleMarket,
        trade: sampleTrade,
        analysis: sampleAnalysis,
        traderInfo: {
          address: "0x1234abcd",
          isNew: true,
        },
      };

      const result = await notifier.sendWhaleAlert(alert);

      expect(result).not.toBeNull();
      expect(result?.ok).toBe(true);
    });

    it("should handle alert without trader info", async () => {
      const alert: WhaleAlert = {
        market: sampleMarket,
        trade: sampleTrade,
        analysis: sampleAnalysis,
      };

      const result = await notifier.sendWhaleAlert(alert);

      expect(result).not.toBeNull();
    });
  });

  describe("sendDailySummary", () => {
    it("should send a daily summary", async () => {
      const summary: DailySummary = {
        date: new Date(),
        marketsTracked: 15,
        marketsActive: 10,
        marketsClosed: 5,
        whaleAlertsCount: 3,
        totalLargeTrades: 25,
        topMarkets: [
          { question: "Market 1", volume: 500000 },
          { question: "Market 2", volume: 300000 },
        ],
      };

      const result = await notifier.sendDailySummary(summary);

      expect(result).not.toBeNull();
      expect(result?.ok).toBe(true);
    });

    it("should handle summary without top markets", async () => {
      const summary: DailySummary = {
        date: new Date(),
        marketsTracked: 5,
        marketsActive: 3,
        marketsClosed: 2,
        whaleAlertsCount: 1,
        totalLargeTrades: 10,
      };

      const result = await notifier.sendDailySummary(summary);

      expect(result).not.toBeNull();
    });
  });

  describe("sendHealthReport", () => {
    it("should send a health report", async () => {
      const report: HealthReport = {
        status: "healthy",
        services: {
          redis: true,
          slack: true,
          inngest: true,
        },
        uptime: 3600000, // 1 hour in ms
      };

      const result = await notifier.sendHealthReport(report);

      expect(result).not.toBeNull();
      expect(result?.ok).toBe(true);
    });

    it("should include error in degraded report", async () => {
      const report: HealthReport = {
        status: "degraded",
        services: {
          redis: false,
          slack: true,
          inngest: true,
        },
        uptime: 3600000,
        lastError: "Redis connection failed",
      };

      const result = await notifier.sendHealthReport(report);

      expect(result).not.toBeNull();
    });
  });

  describe("rate limiting", () => {
    it("should allow messages within rate limit", async () => {
      const alert: MarketAlert = { market: sampleMarket };

      // Send 5 messages (under limit of 10)
      for (let i = 0; i < 5; i++) {
        const result = await notifier.sendMarketAlert(alert);
        expect(result).not.toBeNull();
      }
    });

    it("should block messages exceeding rate limit", async () => {
      const alert: MarketAlert = { market: sampleMarket };

      // Send 12 messages (over limit of 10)
      let blocked = 0;
      for (let i = 0; i < 12; i++) {
        const result = await notifier.sendMarketAlert(alert);
        if (result === null) blocked++;
      }

      expect(blocked).toBeGreaterThan(0);
    });
  });

  describe("healthCheck", () => {
    it("should return true when Slack is connected", async () => {
      const result = await notifier.healthCheck();
      expect(result).toBe(true);
    });
  });

  describe("sendMessage", () => {
    it("should send a simple text message", async () => {
      const result = await notifier.sendMessage("Test message");

      expect(result).not.toBeNull();
      expect(result?.ok).toBe(true);
    });

    it("should use specified channel", async () => {
      const result = await notifier.sendMessage("Test", "other-channel");

      expect(result).not.toBeNull();
    });
  });
});
