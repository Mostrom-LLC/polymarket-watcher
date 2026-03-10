import { Inngest } from "inngest";
import { GammaApiClient } from "../api/gamma-client.js";
import { ClobApiClient } from "../api/clob-client.js";
import { MarketCache } from "../cache/redis.js";
import { TopicClassifier } from "../agents/topic-classifier.js";
import { WhaleAnalyzer } from "../agents/whale-analyzer.js";
import { SlackNotifier, type MarketAlert, type WhaleAlert, type DailySummary } from "../notifications/slack.js";
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

/**
 * Hydrate whale analysis result (with nested trades)
 */
function hydrateWhaleAnalysis(data: unknown): import("../agents/whale-analyzer.js").WhaleAnalysisResult {
  const analysis = data as Record<string, unknown>;
  const largestBets = (analysis.largestBets as unknown[])?.map(hydrateTrade) ?? [];
  return {
    hasWhaleActivity: analysis.hasWhaleActivity as boolean,
    largestBets,
    marketLean: analysis.marketLean as "YES" | "NO" | "NEUTRAL",
    momentum: analysis.momentum as string,
    recommendation: analysis.recommendation as "LEAN_YES" | "LEAN_NO" | "HOLD",
    confidence: analysis.confidence as "HIGH" | "MEDIUM" | "LOW",
    reasoning: analysis.reasoning as string,
  };
}

// =============================================================================
// Market Discovery Workflow (every 15 minutes)
// =============================================================================

/**
 * Discover markets closing today and filter by topics
 * Runs every 15 minutes per AC
 */
const discoverMarkets = inngest.createFunction(
  {
    id: "discover-markets",
    name: "Market Discovery",
  },
  { cron: "*/15 * * * *" }, // Every 15 minutes
  async ({ step }) => {
    const config = getConfig();
    
    // Initialize services
    const gammaApi = new GammaApiClient();
    const cache = new MarketCache(config.env.REDIS_URL);
    const classifier = new TopicClassifier(config.env.GEMINI_API_KEY, {
      model: config.user.ai.model,
      maxTokens: config.user.ai.maxTokens,
      temperature: config.user.ai.temperature,
    });

    // Step 1: Fetch markets closing in next 24 hours
    const marketsRaw = await step.run("fetch-closing-markets", async () => {
      const closingSoon = await gammaApi.getMarketsClosingSoon(24);
      console.log(`[discover-markets] Found ${closingSoon.length} markets closing in 24h`);
      return closingSoon.map((m) => gammaApi.normalizeMarket(m));
    });

    // Hydrate the markets (reconstruct Date objects)
    const markets = (marketsRaw as unknown[]).map(hydrateMarket);

    if (markets.length === 0) {
      console.log("[discover-markets] No markets found closing in 24h");
      return { scanned: 0, matched: 0 };
    }

    // Step 2: Get watched topics from config
    const topics = config.user.markets.map((m) => m.slug);
    
    if (topics.length === 0) {
      // Cache all closing markets if no topic filter
      await step.run("cache-all-markets", async () => {
        await cache.setTodayMarkets(markets);
      });
      console.log(`[discover-markets] Cached ${markets.length} markets (no topic filter)`);
      return { scanned: markets.length, matched: markets.length };
    }

    // Step 3: Classify markets by topics (using batchClassify)
    const classificationResults = await step.run("classify-markets", async () => {
      const results = await classifier.batchClassify(markets, topics);
      const relevant = results.filter((r) => r.isRelevant && r.relevanceScore >= 60);
      console.log(`[discover-markets] ${relevant.length}/${markets.length} markets match topics`);
      return relevant.map((r) => r.market);
    });

    const matchedMarketsRaw = classificationResults;

    const matchedMarkets = (matchedMarketsRaw as unknown[]).map(hydrateMarket);

    // Step 4: Cache matched markets
    await step.run("cache-matched-markets", async () => {
      await cache.setTodayMarkets(matchedMarkets);
    });

    console.log(`[discover-markets] Discovery complete: ${matchedMarkets.length} markets cached`);
    return { scanned: markets.length, matched: matchedMarkets.length };
  }
);

// =============================================================================
// Trade Monitor Workflow (every 5 minutes)
// =============================================================================

/**
 * Monitor trades for all cached markets
 * Runs every 5 minutes per AC
 */
const monitorTrades = inngest.createFunction(
  {
    id: "monitor-trades",
    name: "Trade Monitor",
  },
  { cron: "*/5 * * * *" }, // Every 5 minutes
  async ({ step }) => {
    const config = getConfig();
    const clobApi = new ClobApiClient();
    const cache = new MarketCache(config.env.REDIS_URL);
    const analyzer = new WhaleAnalyzer(config.env.GEMINI_API_KEY, {
      model: config.user.ai.model,
      maxTokens: config.user.ai.maxTokens,
      temperature: config.user.ai.temperature,
    });
    const notifier = new SlackNotifier(
      config.env.SLACK_BOT_TOKEN,
      config.env.SLACK_DEFAULT_CHANNEL
    );

    // Step 1: Get all tracked markets from cache
    const marketsRaw = await step.run("get-tracked-markets", async () => {
      return cache.getTodayMarkets();
    });

    const markets = (marketsRaw as unknown[]).map(hydrateMarket);

    if (markets.length === 0) {
      console.log("[monitor-trades] No markets being tracked");
      return { monitored: 0, whalesDetected: 0 };
    }

    let whalesDetected = 0;

    // Step 2: Check each market for whale activity
    for (const market of markets) {
      // Fetch large trades ($50k+) for each token
      const largeTradesRaw = await step.run(`fetch-trades-${market.id}`, async () => {
        const allTrades: NormalizedTrade[] = [];
        for (const tokenId of market.tokenIds) {
          const trades = await clobApi.getLargeTrades(tokenId, 50000, { limit: 20 });
          const normalized = trades.map((t) => clobApi.normalizeTrade(t, market.id));
          allTrades.push(...normalized);
        }
        return allTrades;
      });

      const largeTrades = (largeTradesRaw as unknown[]).map(hydrateTrade);

      if (largeTrades.length === 0) {
        continue;
      }

      // Check for new trades (not already cached)
      const newTradesRaw = await step.run(`filter-new-${market.id}`, async () => {
        const cachedTrades = await cache.getLargeTrades(market.id);
        const cachedIds = new Set(cachedTrades.map((t) => t.id));
        return largeTrades.filter((t) => !cachedIds.has(t.id));
      });

      const newTrades = (newTradesRaw as unknown[]).map(hydrateTrade);

      if (newTrades.length === 0) {
        continue;
      }

      // Cache new trades
      await step.run(`cache-trades-${market.id}`, async () => {
        for (const trade of newTrades) {
          await cache.addLargeTrade(market.id, trade);
        }
      });

      // Run AI analysis on whale activity (using analyzeTrades)
      const analysisRaw = await step.run(`analyze-whales-${market.id}`, async () => {
        return analyzer.analyzeTrades(market, newTrades);
      });

      // Hydrate analysis (Date objects from JSON)
      const analysis = hydrateWhaleAnalysis(analysisRaw);

      // Send whale alert (throttled per market)
      const wasRecentlyAlerted = await step.run(`check-whale-alert-${market.id}`, async () => {
        // Use a separate key for whale alerts (distinct from closing alerts)
        const exists = await cache.wasAlerted(market.id);
        return exists;
      });

      if (!wasRecentlyAlerted && analysis.hasWhaleActivity) {
        await step.run(`send-whale-alert-${market.id}`, async () => {
          // Get the largest trade for the alert
          const largestTrade = analysis.largestBets[0];
          if (largestTrade) {
            const whaleAlert: WhaleAlert = {
              market,
              trade: largestTrade,
              analysis,
              traderInfo: largestTrade.traderAddress ? {
                address: largestTrade.traderAddress,
                isNew: false, // Would need external data to determine
              } : undefined,
            };
            await notifier.sendWhaleAlert(whaleAlert);
          }
          // Mark as alerted for 15 minutes
          await cache.markAlerted(market.id, 900);
        });
        whalesDetected++;
      }
    }

    console.log(`[monitor-trades] Monitored ${markets.length} markets, detected ${whalesDetected} whale events`);
    return { monitored: markets.length, whalesDetected };
  }
);

// =============================================================================
// Close Alert Workflow (every 5 minutes)
// =============================================================================

/**
 * Check for markets closing soon and send alerts
 * Alerts at T-30 minutes
 */
const closeAlert = inngest.createFunction(
  {
    id: "close-alert",
    name: "Close Alert",
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

      // Alert at T-30 minutes (between 25-35 min window to catch it)
      if (minutesUntilClose > 25 && minutesUntilClose <= 35) {
        const closeAlertKey = `close-alerted:${market.id}`;
        const wasAlerted = await step.run(`check-close-alert-${market.id}`, async () => {
          return cache.wasAlerted(market.id);
        });

        if (!wasAlerted) {
          await step.run(`send-close-alert-${market.id}`, async () => {
            const alert: MarketAlert = {
              market,
            };
            await notifier.sendMarketAlert(alert);
            // Mark as alerted for 1 hour (won't re-alert)
            await cache.markAlerted(market.id, 3600);
          });
          alertsSent.push(market.id);
        }
      }
    }

    console.log(`[close-alert] Checked ${markets.length} markets, sent ${alertsSent.length} alerts`);
    return { checked: markets.length, alertsSent: alertsSent.length };
  }
);

// =============================================================================
// Daily Summary Workflow (9 PM daily)
// =============================================================================

/**
 * Generate daily summary of activity
 * Runs at 9 PM daily per AC
 */
const dailySummary = inngest.createFunction(
  {
    id: "daily-summary",
    name: "Daily Summary",
  },
  { cron: "0 21 * * *" }, // 9 PM daily
  async ({ step }) => {
    const config = getConfig();
    const cache = new MarketCache(config.env.REDIS_URL);
    const notifier = new SlackNotifier(
      config.env.SLACK_BOT_TOKEN,
      config.env.SLACK_DEFAULT_CHANNEL
    );

    // Get today's tracked markets
    const marketsRaw = await step.run("get-today-markets", async () => {
      return cache.getTodayMarkets();
    });

    const markets = (marketsRaw as unknown[]).map(hydrateMarket);

    // Gather stats
    const stats = await step.run("gather-stats", async () => {
      let totalTrades = 0;
      let marketsWithWhales = 0;

      for (const market of markets) {
        const trades = await cache.getLargeTrades(market.id);
        if (trades.length > 0) {
          totalTrades += trades.length;
          marketsWithWhales++;
        }
      }

      return {
        marketsTracked: markets.length,
        marketsWithWhaleActivity: marketsWithWhales,
        totalLargeTrades: totalTrades,
      };
    });

    // Generate summary message
    const closedMarkets = markets.filter((m) => m.endDate && m.endDate < new Date());
    const activeMarkets = markets.filter((m) => m.endDate && m.endDate >= new Date());

    // Send daily summary to Slack using sendDailySummary
    await step.run("send-summary", async () => {
      const summary: DailySummary = {
        date: new Date(),
        marketsTracked: stats.marketsTracked,
        marketsActive: activeMarkets.length,
        marketsClosed: closedMarkets.length,
        whaleAlertsCount: stats.marketsWithWhaleActivity,
        totalLargeTrades: stats.totalLargeTrades,
        topMarkets: activeMarkets.slice(0, 5).map((m) => ({
          question: m.question,
          volume: m.volume,
        })),
      };

      await notifier.sendDailySummary(summary);
    });

    console.log(`[daily-summary] Summary sent: ${stats.marketsTracked} markets tracked`);
    return stats;
  }
);

/**
 * Export all workflow functions for Inngest registration
 */
export const functions = [discoverMarkets, monitorTrades, closeAlert, dailySummary];
