import { describe, expect, it } from "vitest";
import { WebClient } from "@slack/web-api";
import { SlackNotifier } from "./slack.js";
import type { AnalystAlert } from "../surveillance/alert-pipeline.js";

const slackBotToken = process.env.SLACK_BOT_TOKEN;
const slackChannel = process.env.SLACK_CHANNEL_ID;

describe.skipIf(!slackBotToken || !slackChannel)("Analyst alert integration", () => {
  it("posts a real analyst surveillance alert to the configured Slack channel", async () => {
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
      marketLabel: "Military action against Iran ends on Mar 21",
      direction: "Heavy YES buying",
      priceMove: {
        fromPrice: 0.28,
        toPrice: 0.39,
        deltaPoints: 0.11,
      },
      largestTrade: {
        wallet: "0x317a2bbc16523cb5685793d0d1eb7d6889d08243",
        childSlug: "military-action-against-iran-ends-on-march-21-2026",
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

    expect(result?.ok).toBe(true);
  }, 30000);
});
