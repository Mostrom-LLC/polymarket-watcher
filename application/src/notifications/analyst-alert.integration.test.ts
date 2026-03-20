import { describe, expect, it } from "vitest";
import { WebClient } from "@slack/web-api";
import { SlackNotifier } from "./slack.js";
import type { AnalystAlert } from "../surveillance/alert-pipeline.js";

const slackBotToken = process.env.SLACK_BOT_TOKEN;
const slackChannel = process.env.SLACK_CHANNEL_ID;

function getActionUrls(message: { blocks?: Array<{ type?: string; elements?: Array<{ url?: string }> }> }): string[] {
  const actionBlock = message.blocks?.find((block) => block.type === "actions");
  return actionBlock?.elements?.flatMap((element) => element.url ? [element.url] : []) ?? [];
}

describe.skipIf(!slackBotToken || !slackChannel)("Analyst alert integration", () => {
  it("posts a real analyst surveillance alert with valid market and largest-bet Polymarket URLs", async () => {
    const notifier = new SlackNotifier(slackBotToken!, slackChannel!);
    const slackClient = new WebClient(slackBotToken!);

    await slackClient.conversations.join({ channel: slackChannel! }).catch(() => {
      // Posting will prove access either way.
    });

    const alert: AnalystAlert = {
      fingerprint: `integration-analyst-alert:${Date.now()}`,
      verdict: "escalated",
      summary: "Live surveillance integration test for grouped geopolitical anomaly delivery",
      familySlug: "military-action-against-iran-ends-on",
      familyTitle: "Military action against Iran ends on...?",
      classification: "grouped_exact_date",
      anomalyPattern: "adjacent_bucket_spike",
      anomalySeverity: "high",
      marketLabel: "Military action through March 31",
      marketChildSlug: "military-action-against-iran-continues-through-march-31-2026",
      marketChildLabel: "Through Mar 31",
      direction: "Heavy YES buying",
      priceMove: {
        fromPrice: 0.79,
        toPrice: 0.83,
        deltaPoints: 0.04,
      },
      largestTrade: {
        wallet: "0x317a2bbc16523cb5685793d0d1eb7d6889d08243",
        childSlug: "military-action-against-iran-ends-on-march-21-2026",
        contractLabel: "Mar 21",
        notionalUsd: 48000,
        direction: "YES",
        price: 0.31,
        walletAgeMinutes: 120,
      },
      recommendation: "Lean YES",
      topWallets: [
        {
          wallet: "0x317a2bbc16523cb5685793d0d1eb7d6889d08243",
          childSlug: "military-action-against-iran-ends-on-march-21-2026",
          score: 91,
          band: "high",
          reasons: ["new or low-history wallet", "clustered wallet entry"],
          priorActivityCount: 1,
          repeatedPreEventWins: 2,
          realizedPnlUsd: 175000,
          currentExposureUsd: 120000,
          tradeDirection: "YES",
          tradePrice: 0.31,
          largestTradeUsd: 48000,
          walletAgeMinutes: 120,
        },
      ],
      clusterCount: 1,
      evidence: ["timestamp source: market_deadline", "adjacent thresholds moved together"],
      generatedAt: new Date(),
    };

    const result = await notifier.sendAnalystAlert(alert, slackChannel);
    const history = await slackClient.conversations.history({
      channel: slackChannel!,
      latest: result?.ts,
      oldest: result?.ts,
      inclusive: true,
      limit: 1,
    });
    const postedMessage = history.messages?.[0] as { text?: string; blocks?: Array<{ type?: string; elements?: Array<{ url?: string }> }> } | undefined;
    const actionUrls = postedMessage ? getActionUrls(postedMessage) : [];
    const urlResponses = await Promise.all(actionUrls.map((url) => fetch(url)));

    expect(result?.ok).toBe(true);
    expect(postedMessage?.text).toContain("MARKET ACTIVITY");
    expect(actionUrls).toEqual([
      "https://polymarket.com/event/military-action-against-iran-ends-on/military-action-against-iran-continues-through-march-31-2026#:~:text=Through%20Mar%2031",
      "https://polymarket.com/event/military-action-against-iran-ends-on/military-action-against-iran-ends-on-march-21-2026#:~:text=Mar%2021",
    ]);
    expect(urlResponses.map((response) => response.status)).toEqual([200, 200]);
  }, 30000);
});
