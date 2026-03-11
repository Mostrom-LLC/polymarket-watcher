import { describe, expect, it } from "vitest";
import { WebClient } from "@slack/web-api";
import { MarketRecommender } from "../agents/market-recommender.js";
import { analyzeWhaleTrades } from "../agents/whale-analyzer.js";
import { SlackNotifier } from "./slack.js";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";

const geminiApiKey = process.env.GEMINI_API_KEY;
const slackBotToken = process.env.SLACK_BOT_TOKEN;
const slackTestChannel = process.env.SLACK_TEST_CHANNEL ?? process.env.SLACK_CHANNEL_ID;

const sampleMarket: NormalizedMarket = {
  id: "market-alert-1",
  question: "Will Bitcoin close above $90,000 by tomorrow night?",
  slug: "bitcoin-90k-tomorrow",
  outcomes: ["Yes", "No"],
  outcomePrices: [0.68, 0.32],
  volume: 2400000,
  liquidity: 900000,
  endDate: new Date(Date.now() + 30 * 60 * 1000),
  active: true,
  closed: false,
  tokenIds: ["yes-token", "no-token"],
};

const sampleTrades: NormalizedTrade[] = [
  {
    id: "trade-1",
    marketId: sampleMarket.id,
    tokenId: "yes-token",
    side: "BUY",
    size: 110000,
    price: 0.66,
    timestamp: new Date(Date.now() - 20 * 60 * 1000),
    outcome: "Yes",
    traderAddress: null,
  },
  {
    id: "trade-2",
    marketId: sampleMarket.id,
    tokenId: "yes-token",
    side: "BUY",
    size: 130000,
    price: 0.71,
    timestamp: new Date(Date.now() - 8 * 60 * 1000),
    outcome: "Yes",
    traderAddress: null,
  },
  {
    id: "trade-3",
    marketId: sampleMarket.id,
    tokenId: "no-token",
    side: "BUY",
    size: 25000,
    price: 0.33,
    timestamp: new Date(Date.now() - 5 * 60 * 1000),
    outcome: "No",
    traderAddress: null,
  },
];

describe.skipIf(!geminiApiKey || !slackBotToken || !slackTestChannel)("Market alert integration", () => {
  it("posts a real unified whale alert with Gemini analysis and recommendation", async () => {
    const recommender = new MarketRecommender(geminiApiKey!, {
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    });
    const notifier = new SlackNotifier(slackBotToken!, slackTestChannel!);
    const slackClient = new WebClient(slackBotToken!);

    await slackClient.conversations.join({ channel: slackTestChannel! }).catch(() => {
      // Some channels cannot be joined explicitly; posting will prove membership either way.
    });

    const analysis = await analyzeWhaleTrades(sampleMarket, sampleTrades, {
      apiKey: geminiApiKey!,
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    });
    const recommendation = await recommender.recommendVote(sampleMarket, sampleTrades);

    const result = await notifier.sendWhaleAlert(
      {
        market: sampleMarket,
        trade: sampleTrades[0]!,
        analysis,
        voteRecommendation: recommendation,
      },
      slackTestChannel
    );

    expect(analysis.hasWhaleActivity).toBe(true);
    expect(recommendation.reasoning.length).toBeGreaterThan(0);
    expect(result?.ok).toBe(true);
  }, 30000);
});
