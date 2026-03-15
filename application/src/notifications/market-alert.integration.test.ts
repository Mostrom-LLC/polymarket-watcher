import { describe, expect, it } from "vitest";
import { WebClient } from "@slack/web-api";
import { GammaApiClient } from "../api/gamma-client.js";
import { ClobApiClient } from "../api/clob-client.js";
import { isBinaryYesNoMarket, type NormalizedMarket, type NormalizedTrade } from "../api/types.js";
import { MarketRecommender } from "../agents/market-recommender.js";
import { analyzeWhaleTrades } from "../agents/whale-analyzer.js";
import { SlackNotifier } from "./slack.js";

const geminiApiKey = process.env.GEMINI_API_KEY;
const slackBotToken = process.env.SLACK_BOT_TOKEN;
const slackTestChannel = process.env.SLACK_TEST_CHANNEL ?? process.env.SLACK_CHANNEL_ID;

async function findLiveBinaryMarketWithTrades(): Promise<{
  market: NormalizedMarket;
  trades: NormalizedTrade[];
}> {
  const gammaApi = new GammaApiClient();
  const clobApi = new ClobApiClient();
  const markets = await gammaApi.getMarkets({ active: true, closed: false, limit: 50 });

  for (const market of markets.map((item) => gammaApi.normalizeMarket(item))) {
    if (!isBinaryYesNoMarket(market) || market.tokenIds.length === 0) {
      continue;
    }

    const trades = (
      await Promise.all(
        market.tokenIds.map(async (tokenId) => {
          const result = await clobApi.getTradesByToken(tokenId, { limit: 10 });
          return result.trades.map((trade) => clobApi.normalizeTrade(trade, market.id));
        })
      )
    ).flat();

    if (trades.length >= 2) {
      return { market, trades };
    }
  }

  throw new Error("Failed to find a live binary market with recent trades");
}

function getActionUrl(message: { blocks?: Array<{ type?: string; elements?: Array<{ url?: string }> }> }): string | null {
  const actionBlock = message.blocks?.find((block) => block.type === "actions");
  return actionBlock?.elements?.[0]?.url ?? null;
}

describe.skipIf(!geminiApiKey || !slackBotToken || !slackTestChannel)("Market alert integration", () => {
  it("posts a real unified whale alert with a valid live Polymarket URL to Slack", async () => {
    const recommender = new MarketRecommender(geminiApiKey!, {
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    });
    const notifier = new SlackNotifier(slackBotToken!, slackTestChannel!);
    const slackClient = new WebClient(slackBotToken!);
    const { market, trades } = await findLiveBinaryMarketWithTrades();

    await slackClient.conversations.join({ channel: slackTestChannel! }).catch(() => {
      // Some channels cannot be joined explicitly; posting will prove membership either way.
    });

    const analysis = await analyzeWhaleTrades(market, trades, {
      apiKey: geminiApiKey!,
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    });
    const recommendation = await recommender.recommendVote(market, trades);

    const result = await notifier.sendWhaleAlert(
      {
        market,
        trade: analysis.largestBets[0] ?? trades[0]!,
        analysis,
        voteRecommendation: recommendation,
      },
      slackTestChannel
    );

    const history = await slackClient.conversations.history({
      channel: slackTestChannel!,
      latest: result?.ts,
      oldest: result?.ts,
      inclusive: true,
      limit: 1,
    });
    const postedMessage = history.messages?.[0] as { text?: string; blocks?: Array<{ type?: string; elements?: Array<{ url?: string }> }> } | undefined;
    const actionUrl = postedMessage ? getActionUrl(postedMessage) : null;
    const urlResponse = actionUrl ? await fetch(actionUrl) : null;

    expect(analysis.largestBets.length).toBeGreaterThan(0);
    expect(recommendation.reasoning.length).toBeGreaterThan(0);
    expect(result?.ok).toBe(true);
    expect(postedMessage?.text).toContain("WHALE ALERT");
    expect(actionUrl).toBe(`https://polymarket.com/event/${market.slug}`);
    expect(urlResponse?.status).toBe(200);
  }, 30000);
});
