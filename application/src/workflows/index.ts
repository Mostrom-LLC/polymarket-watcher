import { Inngest } from "inngest";
import { GammaApiClient } from "../api/gamma-client.js";
import { ClobApiClient } from "../api/clob-client.js";
import { DataApiClient } from "../api/data-client.js";
import { getMarketCache } from "../cache/redis.js";
import { batchClassifyMarkets } from "../agents/topic-classifier.js";
import { MarketRecommender, type MarketVoteRecommendation } from "../agents/market-recommender.js";
import { analyzeWhaleTrades } from "../agents/whale-analyzer.js";
import { SlackNotifier, type MarketAlert, type WhaleAlert, type DailySummary } from "../notifications/slack.js";
import { getConfig } from "../config/loader.js";
import {
  isBinaryYesNoMarket,
  normalizeOutcomeLabel,
  type GammaEvent,
  type NormalizedMarket,
  type NormalizedTrade,
} from "../api/types.js";
import { classifyMarketFamily, type MarketFamily } from "../surveillance/market-family.js";
import { deliverAnalystAlert } from "../surveillance/alert-delivery.js";
import { type AnalystVerdict, type EventClock } from "../surveillance/alert-pipeline.js";
import { runSurveillancePipeline } from "../surveillance/surveillance-pipeline.js";
import type { FamilyChildSnapshot } from "../surveillance/family-anomaly.js";
import type { WalletEntryObservation, WalletSuspiciousnessInput } from "../surveillance/wallet-surveillance.js";
import type { ReplayLedgerSnapshot } from "../surveillance/replay-ledger.js";

/**
 * Inngest client instance
 */
export const inngest = new Inngest({
  id: "polymarket-watcher",
  name: "Polymarket Watcher",
});

export const WHALE_THRESHOLD_USD = 10000;
export const SURVEILLANCE_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const SURVEILLANCE_EVENT_FETCH_LIMIT = 200;
export const SURVEILLANCE_MAX_FAMILIES_PER_RUN = 25;
export const SURVEILLANCE_WALLET_LOOKBACK_LIMIT = 50;
export const SURVEILLANCE_TOP_WALLETS_PER_FAMILY = 5;

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

function hydrateMarketVoteRecommendation(data: unknown): MarketVoteRecommendation {
  const recommendation = data as Record<string, unknown>;
  return {
    vote: recommendation.vote as "YES" | "NO" | "HOLD",
    confidence: recommendation.confidence as "HIGH" | "MEDIUM" | "LOW",
    reasoning: recommendation.reasoning as string,
  };
}

export function hasMinimumWhaleTrade(trades: NormalizedTrade[], minimumUsd: number = WHALE_THRESHOLD_USD): boolean {
  return trades.some((trade) => trade.size * trade.price >= minimumUsd);
}

export function shouldDeliverAnalystAlert(verdict: AnalystVerdict): boolean {
  return verdict !== "benign";
}

function isSurveillanceFamily(family: MarketFamily): boolean {
  return family.childMarkets.length > 0;
}

function familyMatchesTopics(family: MarketFamily, topics: string[]): boolean {
  if (topics.length === 0) {
    return true;
  }

  const haystack = [
    family.slug,
    family.title,
    ...family.childMarkets.flatMap((child) => [
      child.slug,
      child.question,
      child.groupItemTitle ?? "",
    ]),
  ].join(" ").toLowerCase();

  return topics.some((topic) => haystack.includes(topic.trim().toLowerCase()));
}

export function findTopicRelevantFamilies(events: GammaEvent[], topics: string[]): MarketFamily[] {
  return events
    .map((event) => classifyMarketFamily(event))
    .filter((family) => isSurveillanceFamily(family) && familyMatchesTopics(family, topics));
}

export function buildMarketDeadlineClock(family: MarketFamily): EventClock {
  const childDeadlines = family.childMarkets
    .map((child) => child.endDate)
    .filter((date): date is Date => date !== null)
    .sort((left, right) => left.getTime() - right.getTime());

  return {
    occurredAt: childDeadlines[0] ?? family.eventEndDate ?? new Date(),
    source: "market_deadline",
    publishedAt: null,
  };
}

function inferTradeDirection(trade: NormalizedTrade): "YES" | "NO" | "UNKNOWN" {
  const outcome = normalizeOutcomeLabel(trade.outcome);
  if (outcome === "yes") {
    return trade.side === "BUY" ? "YES" : "NO";
  }

  if (outcome === "no") {
    return trade.side === "BUY" ? "NO" : "YES";
  }

  return "UNKNOWN";
}

function calculatePriceChange(trades: NormalizedTrade[], now: Date, minutes: number, currentPrice: number): number {
  const windowStart = now.getTime() - minutes * 60 * 1000;
  const windowTrades = trades
    .filter((trade) => trade.timestamp.getTime() >= windowStart)
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

  const baseline = windowTrades[0]?.price;
  return baseline !== undefined ? currentPrice - baseline : 0;
}

function getRecentWalletTrades<T extends NormalizedTrade>(trades: T[], now: Date, minutes: number): T[] {
  const windowStart = now.getTime() - minutes * 60 * 1000;
  return trades.filter((trade) => trade.timestamp.getTime() >= windowStart && trade.traderAddress);
}

async function resolveTradeAddress(
  clobApi: ClobApiClient,
  trade: NormalizedTrade
): Promise<string | null> {
  if (trade.traderAddress) {
    return trade.traderAddress;
  }

  const recent = await clobApi.getTradesByToken(trade.tokenId, { limit: 20 });
  const match = recent.trades
    .map((candidate) => clobApi.normalizeTrade(candidate, trade.marketId))
    .find((candidate) =>
      Math.abs(candidate.timestamp.getTime() - trade.timestamp.getTime()) <= 1000 &&
      Math.abs(candidate.size - trade.size) < 0.0001 &&
      Math.abs(candidate.price - trade.price) < 0.0001 &&
      candidate.traderAddress
    );

  return match?.traderAddress ?? null;
}

async function buildFamilySurveillanceInputs(
  family: MarketFamily,
  clobApi: ClobApiClient,
  dataApi: DataApiClient
): Promise<{
  childSnapshots: FamilyChildSnapshot[];
  walletEntries: WalletEntryObservation[];
  walletInputs: WalletSuspiciousnessInput[];
}> {
  const now = new Date();
  const childSnapshots: FamilyChildSnapshot[] = [];
  const familyTrades: Array<NormalizedTrade & { childSlug: string; childLiquidity: number; childVolume: number; childOpenInterest: number }> = [];

  for (const [childIndex, child] of family.childMarkets.entries()) {
    if (child.tokenIds.length === 0) {
      continue;
    }

    const openInterestMap = await clobApi.getMultipleOpenInterest(child.tokenIds);
    const normalizedTrades = (
      await Promise.all(
        child.tokenIds.map(async (tokenId) => {
          const result = await clobApi.getTradesByToken(tokenId, { limit: 25 });
          return result.trades.map((trade) => clobApi.normalizeTrade(trade, child.id));
        })
      )
    ).flat();

    const yesNoTrades = normalizedTrades.filter((trade) => {
      const label = normalizeOutcomeLabel(trade.outcome);
      return label === "yes" || label === "no";
    });

    const currentPrice = child.outcomePrices[0] ?? 0;
    const openInterest = child.tokenIds.reduce((sum, tokenId) => sum + (openInterestMap.get(tokenId) ?? 0), 0);
    const volume1h = yesNoTrades
      .filter((trade) => trade.timestamp.getTime() >= now.getTime() - 60 * 60 * 1000)
      .reduce((sum, trade) => sum + trade.size * trade.price, 0);

    childSnapshots.push({
      slug: child.slug,
      label: child.groupItemTitle ?? child.question,
      thresholdIndex: child.groupItemThreshold ?? childIndex,
      currentPrice,
      priceChange5m: calculatePriceChange(yesNoTrades, now, 5, currentPrice),
      priceChange1h: calculatePriceChange(yesNoTrades, now, 60, currentPrice),
      volume1h,
      volume24h: child.volume,
      liquidity: child.liquidity,
      openInterest,
    });

    for (const trade of yesNoTrades) {
      familyTrades.push({
        ...trade,
        childSlug: child.slug,
        childLiquidity: child.liquidity,
        childVolume: child.volume,
        childOpenInterest: openInterest,
      });
    }
  }

  const recentWalletTrades = getRecentWalletTrades(familyTrades, now, 60);
  const walletAggregates = new Map<string, {
    wallet: string;
    firstTradeAt: Date;
    notionalUsd: number;
    latestTrade: typeof familyTrades[number];
    largestTradeUsd: number;
    largestTradePrice: number;
    largestTradeDirection: "YES" | "NO" | "UNKNOWN";
  }>();

  for (const trade of recentWalletTrades) {
    const wallet = trade.traderAddress;
    if (!wallet) {
      continue;
    }

    const existing = walletAggregates.get(wallet);
    const tradeNotional = trade.size * trade.price;

    if (!existing) {
      walletAggregates.set(wallet, {
        wallet,
        firstTradeAt: trade.timestamp,
        notionalUsd: tradeNotional,
        latestTrade: trade,
        largestTradeUsd: tradeNotional,
        largestTradePrice: trade.price,
        largestTradeDirection: inferTradeDirection(trade),
      });
      continue;
    }

    existing.notionalUsd += tradeNotional;
    if (trade.timestamp < existing.firstTradeAt) {
      existing.firstTradeAt = trade.timestamp;
    }
    if (trade.timestamp > existing.latestTrade.timestamp) {
      existing.latestTrade = trade;
    }
    if (tradeNotional > existing.largestTradeUsd) {
      existing.largestTradeUsd = tradeNotional;
      existing.largestTradePrice = trade.price;
      existing.largestTradeDirection = inferTradeDirection(trade);
    }
  }

  const topWallets = [...walletAggregates.values()]
    .sort((left, right) => right.notionalUsd - left.notionalUsd)
    .slice(0, SURVEILLANCE_TOP_WALLETS_PER_FAMILY);

  const eventClock = buildMarketDeadlineClock(family);
  const walletEntries: WalletEntryObservation[] = [];
  const walletInputs: WalletSuspiciousnessInput[] = [];

  for (const aggregate of topWallets) {
    const activity = await dataApi.getUserActivity({
      user: aggregate.wallet,
      limit: SURVEILLANCE_WALLET_LOOKBACK_LIMIT,
      sortDirection: "DESC",
    });
    const positions = await dataApi.getUserPositions({
      user: aggregate.wallet,
      limit: 10,
    });
    const closedPositions = await dataApi.getClosedPositions({
      user: aggregate.wallet,
      limit: 20,
    });
    const earliestSeen = [...activity]
      .map((item) => item.timestamp)
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? aggregate.firstTradeAt;
    const profitableClosed = closedPositions.filter((position) => position.realizedPnl > 0);

    walletEntries.push({
      wallet: aggregate.wallet,
      firstSeenAt: earliestSeen,
      familySlug: family.slug,
      childSlug: aggregate.latestTrade.childSlug,
      enteredAt: aggregate.latestTrade.timestamp,
      direction: inferTradeDirection(aggregate.latestTrade),
      notionalUsd: aggregate.notionalUsd,
      priorCoAppearanceCount: 0,
    });

    walletInputs.push({
      wallet: aggregate.wallet,
      familySlug: family.slug,
      childSlug: aggregate.latestTrade.childSlug,
      firstSeenAt: earliestSeen,
      tradePlacedAt: aggregate.latestTrade.timestamp,
      eventOccurredAt: eventClock.occurredAt,
      timestampSource: eventClock.source,
      notionalUsd: aggregate.notionalUsd,
      recentVolume1hUsd: aggregate.latestTrade.childVolume,
      recentLiquidityUsd: aggregate.latestTrade.childLiquidity,
      openInterestUsd: aggregate.latestTrade.childOpenInterest,
      clusterSize: 1,
      repeatedPreEventWins: profitableClosed.length,
      contractSpecificity:
        family.classification === "grouped_exact_date"
          ? "exact_date"
          : family.classification === "grouped_date_threshold"
            ? "date_threshold"
            : family.classification === "candidate_field"
              ? "candidate_field"
              : family.classification === "mention_count_family"
                ? "mention_count"
                : "broad_binary",
      priorActivityCount: activity.length,
      tradeDirection: aggregate.largestTradeDirection,
      tradePrice: aggregate.largestTradePrice,
      largestTradeUsd: aggregate.largestTradeUsd,
      walletAgeMinutes: Math.max(
        0,
        Math.round((aggregate.latestTrade.timestamp.getTime() - earliestSeen.getTime()) / (1000 * 60))
      ),
    });
  }

  return {
    childSnapshots,
    walletEntries,
    walletInputs,
  };
}

// =============================================================================
// Market Discovery Workflow (every 15 minutes)
// =============================================================================

/**
 * Discover active topic-relevant binary markets and cache them for trade monitoring
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
    const cache = getMarketCache(config.env.REDIS_URL);

    // Step 1: Fetch active markets instead of restricting to a closing-soon window.
    const marketsRaw = await step.run("fetch-active-markets", async () => {
      const activeMarkets = await gammaApi.getMarkets({ active: true, closed: false });
      console.log(`[discover-markets] Found ${activeMarkets.length} active markets`);
      return activeMarkets.map((m) => gammaApi.normalizeMarket(m));
    });

    // Hydrate the markets (reconstruct Date objects)
    const markets = (marketsRaw as unknown[]).map(hydrateMarket);

    if (markets.length === 0) {
      console.log("[discover-markets] No active markets found");
      return { scanned: 0, matched: 0 };
    }

    // Step 2: Get watched topics from config
    const topics = config.user.markets.map((m) => m.slug);
    
    if (topics.length === 0) {
      const supportedMarkets = markets.filter((market) => isBinaryYesNoMarket(market));

      await step.run("cache-all-markets", async () => {
        await cache.setTodayMarkets(supportedMarkets);
      });
      console.log(`[discover-markets] Cached ${supportedMarkets.length} active binary markets (no topic filter)`);
      return { scanned: markets.length, matched: supportedMarkets.length };
    }

    // Step 3: Classify markets by topics (using batchClassify)
    const classificationResults = await step.run("classify-markets", async () => {
      const results = await batchClassifyMarkets(markets, topics, {
        apiKey: config.env.GEMINI_API_KEY,
        model: config.user.ai.model,
        maxTokens: config.user.ai.maxTokens,
        temperature: config.user.ai.temperature,
      });
      const relevant = results.filter((r) => r.isRelevant && r.relevanceScore >= 60);
      console.log(`[discover-markets] ${relevant.length}/${markets.length} markets match topics`);
      return relevant.map((r) => r.market);
    });

    const matchedMarketsRaw = classificationResults;

    const matchedMarkets = (matchedMarketsRaw as unknown[]).map(hydrateMarket);
    const supportedMarkets = matchedMarkets.filter((market) => isBinaryYesNoMarket(market));
    const skippedUnsupportedCount = matchedMarkets.length - supportedMarkets.length;

    if (skippedUnsupportedCount > 0) {
      console.log(`[discover-markets] Skipping ${skippedUnsupportedCount} non-binary markets`);
    }

    // Step 4: Cache matched markets
    await step.run("cache-matched-markets", async () => {
      await cache.setTodayMarkets(supportedMarkets);
    });

    console.log(`[discover-markets] Discovery complete: ${supportedMarkets.length} markets cached`);
    return { scanned: markets.length, matched: supportedMarkets.length };
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
    const cache = getMarketCache(config.env.REDIS_URL);
    const recommender = new MarketRecommender(config.env.GEMINI_API_KEY, {
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
      if (!isBinaryYesNoMarket(market)) {
        console.log(`[monitor-trades] Skipping unsupported market structure: ${market.question}`);
        continue;
      }

      // Fetch large trades ($10k+) for each token
      const largeTradesRaw = await step.run(`fetch-trades-${market.id}`, async () => {
        const tokenOutcomeMap = new Map(
          market.tokenIds.map((tokenId, index) => [tokenId, market.outcomes[index] ?? null])
        );
        const allTrades: NormalizedTrade[] = [];
        for (const tokenId of market.tokenIds) {
          const trades = await clobApi.getLargeTrades(tokenId, WHALE_THRESHOLD_USD, { limit: 20 });
          const normalized = trades.map((trade) => {
            const hydrated = clobApi.normalizeTrade(trade, market.id);
            return {
              ...hydrated,
              outcome: hydrated.outcome ?? tokenOutcomeMap.get(tokenId) ?? null,
            };
          });
          allTrades.push(...normalized);
        }
        return allTrades;
      });

      const largeTrades = (largeTradesRaw as unknown[]).map(hydrateTrade);

      if (!hasMinimumWhaleTrade(largeTrades)) {
        continue;
      }

      // Check for new trades (not already cached)
      const newTradesRaw = await step.run(`filter-new-${market.id}`, async () => {
        const cachedTrades = await cache.getLargeTrades(market.id);
        const cachedIds = new Set(cachedTrades.map((t) => t.id));
        return largeTrades.filter((t) => !cachedIds.has(t.id));
      });

      const newTrades = (newTradesRaw as unknown[]).map(hydrateTrade);

      if (!hasMinimumWhaleTrade(newTrades)) {
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
        return analyzeWhaleTrades(market, newTrades, {
          apiKey: config.env.GEMINI_API_KEY,
          model: config.user.ai.model,
          maxTokens: config.user.ai.maxTokens,
          temperature: config.user.ai.temperature,
        });
      });

      // Hydrate analysis (Date objects from JSON)
      const analysis = hydrateWhaleAnalysis(analysisRaw);

      if (!analysis.hasWhaleActivity) {
        continue;
      }

      const recommendationRaw = await step.run(`recommend-whale-signal-${market.id}`, async () => {
        return recommender.recommendVote(market, newTrades);
      });
      const voteRecommendation = hydrateMarketVoteRecommendation(recommendationRaw);

      // Send whale alert (throttled per market)
      const wasRecentlyAlerted = await step.run(`check-whale-alert-${market.id}`, async () => {
        const exists = await cache.wasAlerted(market.id);
        return exists;
      });

      if (!wasRecentlyAlerted) {
        await step.run(`send-whale-alert-${market.id}`, async () => {
          const largestTrade = analysis.largestBets[0];
          if (largestTrade) {
            const traderAddress = await resolveTradeAddress(clobApi, largestTrade);
            const whaleAlert: WhaleAlert = {
              market,
              trade: {
                ...largestTrade,
                traderAddress,
              },
              analysis,
              voteRecommendation,
              traderInfo: traderAddress ? {
                address: traderAddress,
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
    const cache = getMarketCache(config.env.REDIS_URL);
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

const monitorSurveillance = inngest.createFunction(
  {
    id: "monitor-surveillance",
    name: "Surveillance Monitor",
  },
  { cron: "*/10 * * * *" },
  async ({ step }) => {
    const config = getConfig();
    const gammaApi = new GammaApiClient();
    const clobApi = new ClobApiClient();
    const dataApi = new DataApiClient();
    const cache = getMarketCache(config.env.REDIS_URL);
    const notifier = new SlackNotifier(
      config.env.SLACK_BOT_TOKEN,
      config.env.SLACK_DEFAULT_CHANNEL
    );

    const topics = config.user.markets.map((market) => market.slug);
    const eventsRaw = await step.run("fetch-surveillance-events", async () => {
      return gammaApi.getEvents({ limit: SURVEILLANCE_EVENT_FETCH_LIMIT });
    });
    const families = findTopicRelevantFamilies(eventsRaw as GammaEvent[], topics).slice(0, SURVEILLANCE_MAX_FAMILIES_PER_RUN);

    let snapshot = await step.run("get-surveillance-ledger", async () => {
      return cache.getSurveillanceLedgerSnapshot();
    }) as ReplayLedgerSnapshot;

    let alertsSent = 0;

    for (const family of families as MarketFamily[]) {
      const inputs = await buildFamilySurveillanceInputs(family, clobApi, dataApi);

      if (inputs.childSnapshots.length === 0 || inputs.walletInputs.length === 0) {
        continue;
      }

      const result = runSurveillancePipeline({
        family,
        childSnapshots: inputs.childSnapshots,
        walletEntries: inputs.walletEntries,
        walletInputs: inputs.walletInputs,
        eventClock: buildMarketDeadlineClock(family),
        generatedAt: new Date(),
      });

      if (!shouldDeliverAnalystAlert(result.alert.verdict)) {
        continue;
      }

      const delivery = await deliverAnalystAlert({
        alert: result.alert,
        notifier,
        snapshot,
        cooldownMs: SURVEILLANCE_ALERT_COOLDOWN_MS,
      });

      snapshot = delivery.snapshot;

      if (delivery.sent) {
        alertsSent++;
      }
    }

    await step.run("persist-surveillance-ledger", async () => {
      await cache.setSurveillanceLedgerSnapshot(snapshot);
    });

    return {
      familiesScanned: (families as MarketFamily[]).length,
      alertsSent,
    };
  }
);

/**
 * Export all workflow functions for Inngest registration
 */
export const functions = [discoverMarkets, monitorSurveillance, dailySummary];
