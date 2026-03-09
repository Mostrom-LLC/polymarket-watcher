import { WebClient, type ChatPostMessageResponse } from "@slack/web-api";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";
import type { WhaleAnalysis } from "../agents/topic-classifier.js";

/**
 * Market alert types
 */
export type AlertType =
  | "market_closing"
  | "whale_detected"
  | "price_movement"
  | "daily_summary";

/**
 * Market alert payload
 */
export interface MarketAlert {
  type: AlertType;
  market: NormalizedMarket;
  title: string;
  message: string;
  severity: "low" | "medium" | "high";
  aiSummary?: string;
  priceChange?: number;
  trades?: NormalizedTrade[];
  whaleAnalysis?: WhaleAnalysis;
}

/**
 * Slack message attachment (Block Kit)
 */
interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text?: string | { type: string; text: string };
    url?: string;
    style?: string;
  }>;
  fields?: Array<{
    type: string;
    text: string;
  }>;
  accessory?: {
    type: string;
    text: { type: string; text: string };
    url: string;
  };
}

/**
 * Slack Notifier Service
 * 
 * Sends formatted alerts to Slack channels.
 */
export class SlackNotifier {
  private client: WebClient;
  private defaultChannel: string;

  constructor(token: string, defaultChannel: string) {
    this.client = new WebClient(token);
    this.defaultChannel = defaultChannel;
  }

  /**
   * Send a market alert
   */
  async sendAlert(
    alert: MarketAlert,
    channel?: string
  ): Promise<ChatPostMessageResponse> {
    const blocks = this.buildAlertBlocks(alert);
    const targetChannel = channel ?? this.defaultChannel;

    return this.client.chat.postMessage({
      channel: targetChannel,
      text: alert.title, // Fallback text
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    });
  }

  /**
   * Build Block Kit blocks for an alert
   */
  private buildAlertBlocks(alert: MarketAlert): SlackBlock[] {
    const blocks: SlackBlock[] = [];

    // Header with emoji based on severity/type
    const emoji = this.getAlertEmoji(alert);
    blocks.push({
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} ${alert.title}`,
        emoji: true,
      },
    });

    // Market question
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${alert.market.question}*`,
      },
      accessory: {
        type: "button",
        text: {
          type: "plain_text",
          text: "View on Polymarket",
        },
        url: `https://polymarket.com/event/${alert.market.slug}`,
      },
    });

    // Current odds
    const oddsText = alert.market.outcomes
      .map((outcome, i) => {
        const price = alert.market.outcomePrices[i] ?? 0;
        return `*${outcome}:* ${(price * 100).toFixed(1)}%`;
      })
      .join("  |  ");

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: oddsText,
      },
    });

    // Alert-specific content
    switch (alert.type) {
      case "market_closing":
        blocks.push(...this.buildClosingBlocks(alert));
        break;
      case "whale_detected":
        blocks.push(...this.buildWhaleBlocks(alert));
        break;
      case "price_movement":
        blocks.push(...this.buildPriceMovementBlocks(alert));
        break;
      case "daily_summary":
        blocks.push(...this.buildDailySummaryBlocks(alert));
        break;
    }

    // AI Summary if available
    if (alert.aiSummary) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🤖 *AI Analysis:*\n${alert.aiSummary}`,
        },
      });
    }

    // Context footer
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Volume: $${(alert.market.volume / 1000).toFixed(0)}k | Liquidity: $${(alert.market.liquidity / 1000).toFixed(0)}k | ${new Date().toISOString()}`,
        },
      ],
    });

    return blocks;
  }

  /**
   * Get emoji for alert type/severity
   */
  private getAlertEmoji(alert: MarketAlert): string {
    if (alert.severity === "high") return "🚨";
    
    switch (alert.type) {
      case "market_closing":
        return "⏰";
      case "whale_detected":
        return "🐋";
      case "price_movement":
        return "📈";
      case "daily_summary":
        return "📊";
      default:
        return "📢";
    }
  }

  /**
   * Build blocks for market closing alert
   */
  private buildClosingBlocks(alert: MarketAlert): SlackBlock[] {
    const blocks: SlackBlock[] = [];
    
    if (alert.market.endDate) {
      const timeUntil = this.formatTimeUntil(alert.market.endDate);
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `⏱️ *Closes in:* ${timeUntil}`,
        },
      });
    }

    return blocks;
  }

  /**
   * Build blocks for whale detection alert
   */
  private buildWhaleBlocks(alert: MarketAlert): SlackBlock[] {
    const blocks: SlackBlock[] = [];

    if (alert.trades && alert.trades.length > 0) {
      const tradesText = alert.trades
        .slice(0, 5) // Show top 5 trades
        .map((t) => {
          const value = t.size * t.price;
          const direction = t.side === "BUY" ? "🟢" : "🔴";
          return `${direction} ${t.side} ${t.outcome ?? "?"}: $${value.toFixed(0)} @ ${(t.price * 100).toFixed(1)}%`;
        })
        .join("\n");

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Recent Large Trades:*\n\`\`\`${tradesText}\`\`\``,
        },
      });
    }

    if (alert.whaleAnalysis) {
      const sentimentEmoji = {
        bullish: "📈",
        bearish: "📉",
        neutral: "➡️",
      }[alert.whaleAnalysis.sentiment];

      blocks.push({
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Sentiment:* ${sentimentEmoji} ${alert.whaleAnalysis.sentiment}`,
          },
          {
            type: "mrkdwn",
            text: `*Confidence:* ${(alert.whaleAnalysis.confidence * 100).toFixed(0)}%`,
          },
        ],
      });
    }

    return blocks;
  }

  /**
   * Build blocks for price movement alert
   */
  private buildPriceMovementBlocks(alert: MarketAlert): SlackBlock[] {
    const blocks: SlackBlock[] = [];

    if (alert.priceChange !== undefined) {
      const direction = alert.priceChange > 0 ? "📈" : "📉";
      const sign = alert.priceChange > 0 ? "+" : "";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${direction} *Price Change:* ${sign}${alert.priceChange.toFixed(1)}%`,
        },
      });
    }

    return blocks;
  }

  /**
   * Build blocks for daily summary
   */
  private buildDailySummaryBlocks(alert: MarketAlert): SlackBlock[] {
    // Daily summary can be customized based on needs
    return [];
  }

  /**
   * Format time until a date
   */
  private formatTimeUntil(date: Date): string {
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) {
      return `${diffMins} minutes`;
    } else if (diffHours < 24) {
      return `${diffHours} hours`;
    } else {
      return `${diffDays} days`;
    }
  }

  /**
   * Send a simple text message
   */
  async sendMessage(
    text: string,
    channel?: string
  ): Promise<ChatPostMessageResponse> {
    return this.client.chat.postMessage({
      channel: channel ?? this.defaultChannel,
      text,
    });
  }

  /**
   * Health check - verify Slack connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.client.auth.test();
      return result.ok === true;
    } catch {
      return false;
    }
  }
}
