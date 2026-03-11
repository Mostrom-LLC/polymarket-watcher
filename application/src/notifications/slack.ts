import { WebClient, type ChatPostMessageResponse, type KnownBlock, type Block } from "@slack/web-api";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";
import type { MarketVoteRecommendation } from "../agents/market-recommender.js";
import type { WhaleAnalysisResult } from "../agents/whale-analyzer.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Market alert payload
 */
export interface MarketAlert {
  market: NormalizedMarket;
  largestBets?: NormalizedTrade[];
  marketLean?: string;
  momentum?: string;
  recommendation?: string;
  voteRecommendation?: MarketVoteRecommendation;
}

/**
 * Whale alert payload
 */
export interface WhaleAlert {
  market: NormalizedMarket;
  trade: NormalizedTrade;
  analysis: WhaleAnalysisResult;
  voteRecommendation?: MarketVoteRecommendation;
  traderInfo?: {
    address: string;
    isNew: boolean;
  } | undefined;
}

/**
 * Daily summary payload
 */
export interface DailySummary {
  date: Date;
  marketsTracked: number;
  marketsActive: number;
  marketsClosed: number;
  whaleAlertsCount: number;
  totalLargeTrades: number;
  topMarkets?: Array<{
    question: string;
    volume: number;
  }>;
}

/**
 * Health report payload
 */
export interface HealthReport {
  status: "healthy" | "degraded" | "unhealthy";
  services: {
    redis: boolean;
    slack: boolean;
    inngest: boolean;
  };
  uptime: number;
  lastError?: string;
}

/**
 * Rate limit tracking
 */
interface RateLimitState {
  lastSent: number;
  count: number;
  resetAt: number;
}

// =============================================================================
// Slack Notifier Service
// =============================================================================

/**
 * Slack Notifier Service
 * 
 * Sends formatted alerts to Slack channels with rate limiting.
 */
export class SlackNotifier {
  private client: WebClient;
  private defaultChannel: string;
  private rateLimits: Map<string, RateLimitState> = new Map();
  
  // Rate limit: max 10 messages per minute per channel
  private readonly rateLimitWindow = 60 * 1000; // 1 minute
  private readonly rateLimitMax = 10;

  constructor(token: string, defaultChannel: string) {
    this.client = new WebClient(token);
    this.defaultChannel = defaultChannel;
  }

  // ===========================================================================
  // Rate Limiting
  // ===========================================================================

  /**
   * Check and update rate limit for a channel
   */
  private checkRateLimit(channel: string): boolean {
    const now = Date.now();
    const state = this.rateLimits.get(channel);

    if (!state || now >= state.resetAt) {
      // Reset or initialize
      this.rateLimits.set(channel, {
        lastSent: now,
        count: 1,
        resetAt: now + this.rateLimitWindow,
      });
      return true;
    }

    if (state.count >= this.rateLimitMax) {
      console.warn(`[SlackNotifier] Rate limit exceeded for channel ${channel}`);
      return false;
    }

    state.count++;
    state.lastSent = now;
    return true;
  }

  // ===========================================================================
  // Alert Methods
  // ===========================================================================

  /**
   * Send a market closing alert
   */
  async sendMarketAlert(
    alert: MarketAlert,
    channel?: string
  ): Promise<ChatPostMessageResponse | null> {
    const targetChannel = channel ?? this.defaultChannel;
    
    if (!this.checkRateLimit(targetChannel)) {
      return null;
    }

    const { market, largestBets, marketLean, momentum, recommendation, voteRecommendation } = alert;
    const timeUntilClose = market.endDate 
      ? this.formatTimeUntil(market.endDate) 
      : "Unknown";

    const oddsText = market.outcomes
      .map((o, i) => `${o} ${((market.outcomePrices[i] ?? 0) * 100).toFixed(0)}%`)
      .join(" / ");

    let betsText = "";
    if (largestBets && largestBets.length > 0) {
      betsText = largestBets
        .slice(0, 3)
        .map((t) => `  • $${(t.size * t.price).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} on ${t.outcome ?? "?"} (${this.formatTimeAgo(t.timestamp)})`)
        .join("\n");
    }

    const fallbackText = `🔔 MARKET CLOSING SOON (${timeUntilClose}) - ${market.question}`;

    // Block Kit formatted message
    const blocks: (KnownBlock | Block)[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🔔 MARKET CLOSING SOON (${timeUntilClose})`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${market.question}*`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Current Odds:*\n${oddsText}`,
          },
          {
            type: "mrkdwn",
            text: marketLean ? `*Market Lean:*\n${marketLean}` : " ",
          },
        ],
      },
    ];

    // Add bets section if available
    if (betsText) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `💰 *Largest Recent Bets:*\n${betsText}`,
        },
      });
    }

    // Add recommendation section
    if (voteRecommendation || recommendation) {
      const recommendationText = voteRecommendation
        ? `💡 *Recommendation:* Vote ${voteRecommendation.vote} (${this.formatConfidence(voteRecommendation.confidence)} confidence)\n${voteRecommendation.reasoning}`
        : `💡 *Recommendation:* ${recommendation}${momentum ? `\n${momentum}` : ""}`;

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: recommendationText,
        },
      });
    }

    // Add action button
    blocks.push(
      { type: "divider" },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "View Market",
              emoji: true,
            },
            url: `https://polymarket.com/event/${market.slug}`,
            action_id: `view_market_${market.id}`,
          },
        ],
      }
    );

    return this.client.chat.postMessage({
      channel: targetChannel,
      text: fallbackText,
      blocks,
      unfurl_links: false,
    });
  }

  /**
   * Send a whale activity alert
   */
  async sendWhaleAlert(
    alert: WhaleAlert,
    channel?: string
  ): Promise<ChatPostMessageResponse | null> {
    const targetChannel = channel ?? this.defaultChannel;
    
    if (!this.checkRateLimit(targetChannel)) {
      return null;
    }

    const { market, trade, analysis, voteRecommendation, traderInfo } = alert;
    const tradeValue = trade.size * trade.price;
    const timeUntilClose = market.endDate 
      ? this.formatTimeUntil(market.endDate) 
      : "Unknown";
    const closeDateTime = market.endDate
      ? this.formatCloseDateTime(market.endDate)
      : "Unknown";
    const oddsText = market.outcomes
      .map((outcome, index) => `${outcome} ${((market.outcomePrices[index] ?? 0) * 100).toFixed(0)}%`)
      .join(" / ");

    let whaleSignals = "";
    if (traderInfo?.isNew) whaleSignals += "  • New account ✓\n";
    if (tradeValue >= 10000) whaleSignals += "  • Whale bet ($10k+) ✓\n";
    if (market.endDate && (market.endDate.getTime() - Date.now()) < 24 * 60 * 60 * 1000) {
      whaleSignals += "  • Close to event ✓\n";
    }

    const fallbackText = `🐋 WHALE ALERT — Market Closing Soon - ${market.question}`;
    const formattedValue = tradeValue.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    // Block Kit formatted message
    const blocks: (KnownBlock | Block)[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🐋 WHALE ALERT — Market Closing Soon",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${market.question}*`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Whale Bet:*\n$${formattedValue} on ${trade.outcome ?? "Unknown"}`,
          },
          {
            type: "mrkdwn",
            text: `*Current Odds:*\n${oddsText}`,
          },
          {
            type: "mrkdwn",
            text: `*Account:*\n${traderInfo?.address ?? trade.traderAddress ?? "Unknown"}${traderInfo?.isNew ? " 🆕" : ""}`,
          },
          {
            type: "mrkdwn",
            text: `*Placed:*\n${this.formatTimeAgo(trade.timestamp)}`,
          },
          {
            type: "mrkdwn",
            text: `*Closes:*\n${closeDateTime}`,
          },
          {
            type: "mrkdwn",
            text: `*Time Left:*\n${timeUntilClose}`,
          },
        ],
      },
    ];

    // Add whale signals if present
    if (whaleSignals) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `⚠️ *Whale Signals:* ${whaleSignals.replace(/\n/g, " ")}`,
          },
        ],
      });
    }

    // Add analysis section
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: voteRecommendation
          ? `📈 *Market Lean:* ${analysis.marketLean}\n${analysis.momentum}\n\n💡 *Recommendation:* Vote ${voteRecommendation.vote} (${this.formatConfidence(voteRecommendation.confidence)} confidence)\n${voteRecommendation.reasoning}`
          : `📈 *Market Lean:* ${analysis.marketLean}\n${analysis.momentum}\n\n💡 *Recommendation:* ${this.formatRecommendation(analysis.recommendation)}\n_Confidence: ${analysis.confidence}_`,
      },
    });

    // Add action button
    blocks.push(
      { type: "divider" },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "View Market",
              emoji: true,
            },
            url: `https://polymarket.com/event/${market.slug}`,
            action_id: `view_whale_market_${market.id}`,
          },
        ],
      }
    );

    return this.client.chat.postMessage({
      channel: targetChannel,
      text: fallbackText,
      blocks,
      unfurl_links: false,
    });
  }

  /**
   * Send daily summary
   */
  async sendDailySummary(
    summary: DailySummary,
    channel?: string
  ): Promise<ChatPostMessageResponse | null> {
    const targetChannel = channel ?? this.defaultChannel;
    
    if (!this.checkRateLimit(targetChannel)) {
      return null;
    }

    const dateStr = summary.date.toISOString().split("T")[0];
    
    let topMarketsText = "";
    if (summary.topMarkets && summary.topMarkets.length > 0) {
      topMarketsText = "\n\n*Top Markets by Volume:*\n" + 
        summary.topMarkets
          .slice(0, 5)
          .map((m, i) => `${i + 1}. ${m.question} ($${(m.volume / 1000).toFixed(0)}k)`)
          .join("\n");
    }

    const fallbackText = `📊 Daily Summary — ${dateStr}`;

    // Block Kit formatted message
    const blocks: (KnownBlock | Block)[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `📊 Daily Summary — ${dateStr}`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Markets Tracked:*\n${summary.marketsTracked}`,
          },
          {
            type: "mrkdwn",
            text: `*Active Markets:*\n${summary.marketsActive}`,
          },
          {
            type: "mrkdwn",
            text: `*Closed Markets:*\n${summary.marketsClosed}`,
          },
          {
            type: "mrkdwn",
            text: `*Whale Alerts:*\n${summary.whaleAlertsCount}`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Total Large Trades:* ${summary.totalLargeTrades}`,
        },
      },
    ];

    // Add top markets if available
    if (summary.topMarkets && summary.topMarkets.length > 0) {
      const topMarketsFormatted = summary.topMarkets
        .slice(0, 5)
        .map((m, i) => `${i + 1}. ${m.question} ($${(m.volume / 1000).toFixed(0)}k)`)
        .join("\n");
      
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Top Markets by Volume:*\n${topMarketsFormatted}`,
        },
      });
    }

    return this.client.chat.postMessage({
      channel: targetChannel,
      text: fallbackText,
      blocks,
      unfurl_links: false,
    });
  }

  /**
   * Send health report
   */
  async sendHealthReport(
    report: HealthReport,
    channel?: string
  ): Promise<ChatPostMessageResponse | null> {
    const targetChannel = channel ?? this.defaultChannel;
    
    if (!this.checkRateLimit(targetChannel)) {
      return null;
    }

    const statusEmoji = {
      healthy: "✅",
      degraded: "⚠️",
      unhealthy: "🔴",
    }[report.status];

    const serviceStatus = Object.entries(report.services)
      .map(([name, ok]) => `  • ${name}: ${ok ? "✅" : "❌"}`)
      .join("\n");

    const uptimeHours = (report.uptime / (60 * 60 * 1000)).toFixed(1);

    const fallbackText = `${statusEmoji} System Health Report - ${report.status.toUpperCase()}`;

    // Block Kit formatted message
    const blocks: (KnownBlock | Block)[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${statusEmoji} System Health Report`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Status:*\n${report.status.toUpperCase()}`,
          },
          {
            type: "mrkdwn",
            text: `*Uptime:*\n${uptimeHours} hours`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Services:*\n${serviceStatus}`,
        },
      },
    ];

    // Add error section if present
    if (report.lastError) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Last Error:*\n\`\`\`${report.lastError}\`\`\``,
        },
      });
    }

    return this.client.chat.postMessage({
      channel: targetChannel,
      text: fallbackText,
      blocks,
      unfurl_links: false,
    });
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Send a simple text message
   */
  async sendMessage(
    text: string,
    channel?: string
  ): Promise<ChatPostMessageResponse | null> {
    const targetChannel = channel ?? this.defaultChannel;
    
    if (!this.checkRateLimit(targetChannel)) {
      return null;
    }

    return this.client.chat.postMessage({
      channel: targetChannel,
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

  /**
   * Format time until a date
   */
  private formatTimeUntil(date: Date): string {
    const diffMs = date.getTime() - Date.now();
    if (diffMs < 0) return "Closed";
    
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) {
      return `${diffMins} min`;
    } else if (diffHours < 24) {
      return `${diffHours} hours`;
    } else {
      return `${diffDays} days`;
    }
  }

  /**
   * Format time ago
   */
  private formatTimeAgo(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffMins < 60) {
      return `${diffMins} minutes ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hours ago`;
    } else {
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays} days ago`;
    }
  }

  private formatCloseDateTime(date: Date): string {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  }

  private formatConfidence(confidence: "HIGH" | "MEDIUM" | "LOW"): string {
    switch (confidence) {
      case "HIGH":
        return "High";
      case "MEDIUM":
        return "Medium";
      case "LOW":
        return "Low";
    }
  }

  /**
   * Format recommendation text
   */
  private formatRecommendation(rec: string): string {
    switch (rec) {
      case "LEAN_YES":
        return "Consider YES position";
      case "LEAN_NO":
        return "Consider NO position";
      case "HOLD":
        return "Hold / Wait for more signals";
      default:
        return rec;
    }
  }
}
