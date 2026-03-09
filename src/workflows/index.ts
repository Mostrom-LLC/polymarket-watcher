import { Inngest } from "inngest";
import { GammaApiClient } from "../api/gamma-client.js";
import { ClobApiClient } from "../api/clob-client.js";
import { MarketCache } from "../cache/redis.js";
import { TopicClassifier, WhaleAnalyzer } from "../agents/topic-classifier.js";
import { SlackNotifier, type MarketAlert } from "../notifications/slack.js";
import { getConfig } from "../config/loader.js";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";

/**
 * Inngest client instance
 */
export const inngest = new Inngest({
  id: "polymarket-watcher",
  name: "Polymarket Watcher",
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Reconstruct Date objects from JSON-serialized data
 */
function hydrateMarket(data: unknown): NormalizedMarket {
  const market = data as Record<string, unknown>;
  return {
    id: market.id as string,
    question: market.question as string,
    slug: market.slug as string,
    outcomes: market.outcomes as string[],
    outcomePrices: market.outcomePrices as number[],
    volume: market.volume as number,
    liquidity: market.liquidity as number,
    endDate: market.endDate ? new Date(market.endDate as string) : null,
    active: market.active as boolean,
    closed: market.closed as boolean,
    tokenIds: market.tokenIds as string[],
  };
}

function hydrateTrade(data: unknown): NormalizedTrade {
  const trade = data as Record<string, unknown>;
  return {
    id: trade.id as string,
    marketId: trade.marketId as string,
    tokenId: trade.tokenId as string,
    side: trade.side as "BUY" | "SELL",
    size: trade.size as number,
    price: trade.price as number,
    timestamp: new Date(trade.timestamp as string),
    outcome: trade.outcome as string | null,
    traderAddress: trade.traderAddress as string | null,
  };
}

// =============================================================================
// Event Types
// =============================================================================

type Events = {
  "polymarket/scan-markets": Record<string, never>;
  "polymarket/monitor-trades": { marketId: string };
  "polymarket/check-closing": { marketId: string };
  "polymarket/whale-alert": {
    marketId: string;
    tradeIds: string[];
  };
  "polymarket/daily-summary": Record<string, never>;
};

// =============================================================================
// Market Scanner Workflow
// =============================================================================

/**
 * Scan for markets closing today and filter by topics
 * Runs every 30 minutes
 */
const scanMarkets = inngest.createFunction(
  {
    id: "scan-markets",
    name: "Market Scanner",
  },
  { cron: "*/30 * * * *" },
  async ({ step }) => {
    const config = getConfig();
    
    // Initialize services
    const gammaApi = new GammaApiClient();
    const cache = new MarketCache(config.env.REDIS_URL);
    const classifier = new TopicClassifier(config.env.ANTHROPIC_API_KEY, {
      model: "claude-3-5-haiku-20241022",
    });

    // Step 1: Fetch markets closing in next 24 hours
    const marketsRaw = await step.run("fetch-closing-markets", async () => {
      const closingSoon = await gammaApi.getMarketsClosingSoon(24);
      console.log(`[scan-markets] Found ${closingSoon.length} markets closing in 24h`);
      return closingSoon.map((m) => gammaApi.normalizeMarket(m));
    });

    // Hydrate the markets (reconstruct Date objects)
    const markets = (marketsRaw as unknown[]).map(hydrateMarket);

    if (markets.length === 0) {
      return { scanned: 0, matched: 0 };
    }

    // Step 2: Get watched topics from config
    const topics = config.user.markets.map((m) => m.slug);
    
    if (topics.length === 0) {
      // Cache all closing markets if no topic filter
      await step.run("cache-all-markets", async () => {
        await cache.setTodayMarkets(markets);
      });
      return { scanned: markets.length, matched: markets.length };
    }

    // Step 3: Classify markets by topics
    const matchedMarketsRaw = await step.run("classify-markets", async () => {
      const filtered = await classifier.filterByTopics(markets, topics, 0.6);
      console.log(`[scan-markets] ${filtered.length}/${markets.length} markets match topics`);
      return filtered;
    });

    const matchedMarkets = (matchedMarketsRaw as unknown[]).map(hydrateMarket);

    // Step 4: Cache matched markets
    await step.run("cache-matched-markets", async () => {
      await cache.setTodayMarkets(matchedMarkets);
    });

    // Step 5: Schedule monitoring for each market
    await step.run("schedule-monitoring", async () => {
      for (const market of matchedMarkets) {
        await inngest.send({
          name: "polymarket/monitor-trades",
          data: { marketId: market.id },
        });
      }
    });

    return { scanned: markets.length, matched: matchedMarkets.length };
  }
);

// =============================================================================
// Trade Monitor Workflow
// =============================================================================

/**
 * Monitor trades for a specific market
 * Detects whale activity and triggers alerts
 */
const monitorTrades = inngest.createFunction(
  {
    id: "monitor-trades",
    name: "Trade Monitor",
    throttle: {
      key: "event.data.marketId",
      limit: 1,
      period: "5m",
    },
  },
  { event: "polymarket/monitor-trades" },
  async ({ event, step }) => {
    const { marketId } = event.data;
    const config = getConfig();

    const clobApi = new ClobApiClient();
    const cache = new MarketCache(config.env.REDIS_URL);

    // Step 1: Get market data from cache
    const marketRaw = await step.run("get-market", async () => {
      return cache.getMarket(marketId);
    });

    if (!marketRaw) {
      console.log(`[monitor-trades] Market ${marketId} not found in cache`);
      return { monitored: false, reason: "market_not_found" };
    }

    const market = hydrateMarket(marketRaw);

    // Step 2: Fetch large trades for each token
    const largeTradesRaw = await step.run("fetch-large-trades", async () => {
      const allTrades: NormalizedTrade[] = [];
      for (const tokenId of market.tokenIds) {
        const trades = await clobApi.getLargeTrades(tokenId, 50000, { limit: 20 });
        const normalized = trades.map((t) => clobApi.normalizeTrade(t, marketId));
        allTrades.push(...normalized);
      }
      return allTrades;
    });

    const largeTrades = (largeTradesRaw as unknown[]).map(hydrateTrade);

    if (largeTrades.length === 0) {
      return { monitored: true, tradesFound: 0 };
    }

    // Step 3: Check for new trades (not already cached)
    const newTradesRaw = await step.run("filter-new-trades", async () => {
      const cachedTrades = await cache.getLargeTrades(marketId);
      const cachedIds = new Set(cachedTrades.map((t) => t.id));
      return largeTrades.filter((t) => !cachedIds.has(t.id));
    });

    const newTrades = (newTradesRaw as unknown[]).map(hydrateTrade);

    if (newTrades.length === 0) {
      return { monitored: true, tradesFound: largeTrades.length, newTrades: 0 };
    }

    // Step 4: Cache new trades
    await step.run("cache-trades", async () => {
      for (const trade of newTrades) {
        await cache.addLargeTrade(marketId, trade);
      }
    });

    // Step 5: Trigger whale alert
    await step.run("trigger-whale-alert", async () => {
      await inngest.send({
        name: "polymarket/whale-alert",
        data: {
          marketId,
          tradeIds: newTrades.map((t) => t.id),
        },
      });
    });

    return { monitored: true, tradesFound: largeTrades.length, newTrades: newTrades.length };
  }
);

// =============================================================================
// Whale Alert Workflow
// =============================================================================

/**
 * Analyze whale activity and send alert
 */
const whaleAlert = inngest.createFunction(
  {
    id: "whale-alert",
    name: "Whale Alert",
    throttle: {
      key: "event.data.marketId",
      limit: 1,
      period: "15m", // Max 1 alert per market per 15 min
    },
  },
  { event: "polymarket/whale-alert" },
  async ({ event, step }) => {
    const { marketId } = event.data;
    const config = getConfig();

    const cache = new MarketCache(config.env.REDIS_URL);
    const analyzer = new WhaleAnalyzer(config.env.ANTHROPIC_API_KEY);
    const notifier = new SlackNotifier(
      config.env.SLACK_BOT_TOKEN,
      config.env.SLACK_DEFAULT_CHANNEL
    );

    // Step 1: Get market and trades from cache
    const marketRaw = await step.run("get-market-data", async () => {
      return cache.getMarket(marketId);
    });

    if (!marketRaw) {
      return { alerted: false, reason: "market_not_found" };
    }

    const market = hydrateMarket(marketRaw);

    const tradesRaw = await step.run("get-trades", async () => {
      return cache.getLargeTrades(marketId, 10);
    });

    const trades = (tradesRaw as unknown[]).map(hydrateTrade);

    if (trades.length === 0) {
      return { alerted: false, reason: "no_trades" };
    }

    // Step 2: Run AI analysis
    const analysis = await step.run("analyze-whales", async () => {
      return analyzer.analyzeWhaleActivity(
        market.question,
        trades.map((t) => ({
          side: t.side,
          size: t.size,
          price: t.price,
          outcome: t.outcome,
          timestamp: t.timestamp,
        }))
      );
    });

    // Step 3: Send Slack alert
    await step.run("send-alert", async () => {
      const alert: MarketAlert = {
        type: "whale_detected",
        market,
        title: "Whale Activity Detected",
        message: analysis.summary,
        severity: analysis.confidence > 0.7 ? "high" : "medium",
        aiSummary: analysis.summary,
        trades,
        whaleAnalysis: { ...analysis, marketId },
      };

      await notifier.sendAlert(alert);
    });

    return { alerted: true, tradesAnalyzed: trades.length };
  }
);

// =============================================================================
// Market Closing Alert Workflow
// =============================================================================

/**
 * Check for markets closing soon and send alerts
 */
const checkClosing = inngest.createFunction(
  {
    id: "check-closing",
    name: "Closing Alert Checker",
  },
  { cron: "*/5 * * * *" }, // Every 5 minutes
  async ({ step }) => {
    const config = getConfig();
    const cache = new MarketCache(config.env.REDIS_URL);
    const notifier = new SlackNotifier(
      config.env.SLACK_BOT_TOKEN,
      config.env.SLACK_DEFAULT_CHANNEL
    );

    // Get today's markets
    const marketsRaw = await step.run("get-today-markets", async () => {
      return cache.getTodayMarkets();
    });

    const markets = (marketsRaw as unknown[]).map(hydrateMarket);
    const alertsSent: string[] = [];

    // Check each market
    for (const market of markets) {
      if (!market.endDate) continue;

      const minutesUntilClose = (market.endDate.getTime() - Date.now()) / (1000 * 60);

      // Alert at 30 minutes
      if (minutesUntilClose > 25 && minutesUntilClose <= 35) {
        const wasAlerted = await step.run(`check-alerted-${market.id}`, async () => {
          return cache.wasAlerted(market.id);
        });

        if (!wasAlerted) {
          await step.run(`send-closing-alert-${market.id}`, async () => {
            const alert: MarketAlert = {
              type: "market_closing",
              market,
              title: "Market Closing Soon",
              message: `${market.question} closes in ~30 minutes`,
              severity: "medium",
            };
            await notifier.sendAlert(alert);
            await cache.markAlerted(market.id, 3600); // 1 hour TTL
          });
          alertsSent.push(market.id);
        }
      }
    }

    return { checked: markets.length, alertsSent: alertsSent.length };
  }
);

/**
 * Export all workflow functions for Inngest registration
 */
export const functions = [scanMarkets, monitorTrades, whaleAlert, checkClosing];
