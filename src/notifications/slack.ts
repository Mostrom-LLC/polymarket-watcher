import { WebClient, type ChatPostMessageResponse } from "@slack/web-api";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";
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
}

/**
 * Whale alert payload
 */
export interface WhaleAlert {
  market: NormalizedMarket;
  trade: NormalizedTrade;
  analysis: WhaleAnalysisResult;
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

    const { market, largestBets, marketLean, momentum, recommendation } = alert;
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

    const message = `🔔 *MARKET CLOSING SOON* (${timeUntilClose})

📊 *${market.question}*

Current Odds: ${oddsText}
${betsText ? `\n💰 *Largest Recent Bets:*\n${betsText}` : ""}
${marketLean ? `\n📈 Market Lean: ${marketLean}` : ""}
${momentum ? `   ${momentum}` : ""}
${recommendation ? `\n💡 *Recommendation:* ${recommendation}` : ""}

🔗 <https://polymarket.com/event/${market.slug}|View Market>`;

    return this.client.chat.postMessage({
      channel: targetChannel,
      text: message,
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

    const { market, trade, analysis, traderInfo } = alert;
    const tradeValue = trade.size * trade.price;
    const timeUntilClose = market.endDate 
      ? this.formatTimeUntil(market.endDate) 
      : "Unknown";

    let whaleSignals = "";
    if (traderInfo?.isNew) whaleSignals += "  • New account ✓\n";
    if (tradeValue >= 50000) whaleSignals += "  • Large bet ✓\n";
    if (market.endDate && (market.endDate.getTime() - Date.now()) < 24 * 60 * 60 * 1000) {
      whaleSignals += "  • Close to event ✓\n";
    }

    const message = `🚨 *WHALE ALERT* — Large Bet Detected

📊 *Market:* ${market.question}
⏰ *Closes in:* ${timeUntilClose}

💰 *LARGE BET DETECTED:*
  • $${tradeValue.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} on ${trade.outcome ?? "?"}
  • Account: ${traderInfo?.address ?? trade.traderAddress ?? "Unknown"}${traderInfo?.isNew ? " (NEW)" : ""}
  • Placed: ${this.formatTimeAgo(trade.timestamp)}
${whaleSignals ? `\n⚠️ *Whale Signal*\n${whaleSignals}` : ""}
📈 *Market Lean:* ${analysis.marketLean}
   ${analysis.momentum}

💡 *Recommendation:* ${this.formatRecommendation(analysis.recommendation)}
   Confidence: ${analysis.confidence}

🔗 <https://polymarket.com/event/${market.slug}|View Market>`;

    return this.client.chat.postMessage({
      channel: targetChannel,
      text: message,
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

    const message = `📊 *Daily Summary — ${dateStr}*

*Markets Tracked:* ${summary.marketsTracked}
*Active Markets:* ${summary.marketsActive}
*Closed Markets:* ${summary.marketsClosed}
*Whale Alerts Sent:* ${summary.whaleAlertsCount}
*Total Large Trades:* ${summary.totalLargeTrades}${topMarketsText}`;

    return this.client.chat.postMessage({
      channel: targetChannel,
      text: message,
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

    const message = `${statusEmoji} *System Health Report*

*Status:* ${report.status.toUpperCase()}
*Uptime:* ${uptimeHours} hours

*Services:*
${serviceStatus}${report.lastError ? `\n\n*Last Error:*\n\`${report.lastError}\`` : ""}`;

    return this.client.chat.postMessage({
      channel: targetChannel,
      text: message,
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
