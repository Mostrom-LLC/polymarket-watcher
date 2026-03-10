import Anthropic from "@anthropic-ai/sdk";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";

/**
 * Whale analysis result
 */
export interface WhaleAnalysisResult {
  hasWhaleActivity: boolean;
  largestBets: NormalizedTrade[];
  marketLean: "YES" | "NO" | "NEUTRAL";
  momentum: string;
  recommendation: "LEAN_YES" | "LEAN_NO" | "HOLD";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
}

/**
 * Whale Analyzer Agent
 * 
 * Uses Claude Sonnet to analyze large trade patterns and provide insights.
 * When no API key is provided, returns basic analysis based on trade data alone.
 */
export class WhaleAnalyzer {
  private client: Anthropic | null;
  private model: string;
  private maxTokens: number;
  private readonly aiEnabled: boolean;

  constructor(
    apiKey: string | undefined,
    options: { model?: string; maxTokens?: number } = {}
  ) {
    this.aiEnabled = !!apiKey;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    this.model = options.model ?? "claude-sonnet-4-20250514";
    this.maxTokens = options.maxTokens ?? 1024;
  }

  /**
   * Check if AI analysis is enabled
   */
  isAiEnabled(): boolean {
    return this.aiEnabled;
  }

  /**
   * Create basic analysis from trade data without AI
   */
  private createBasicAnalysis(
    trades: NormalizedTrade[],
    largestBets: NormalizedTrade[],
    yesVolume: number,
    noVolume: number,
    totalVolume: number
  ): WhaleAnalysisResult {
    return {
      hasWhaleActivity: totalVolume > 100000,
      largestBets,
      marketLean: yesVolume > noVolume * 1.2 ? "YES" : noVolume > yesVolume * 1.2 ? "NO" : "NEUTRAL",
      momentum: `$${Math.abs(yesVolume - noVolume).toFixed(0)} toward ${yesVolume > noVolume ? "YES" : "NO"}`,
      recommendation: "HOLD",
      confidence: "LOW",
      reasoning: this.aiEnabled ? "Analysis failed, using trade data fallback" : "AI analysis disabled - using trade data only",
    };
  }

  /**
   * Analyze trades for whale activity
   */
  async analyzeTrades(
    market: NormalizedMarket,
    trades: NormalizedTrade[]
  ): Promise<WhaleAnalysisResult> {
    if (trades.length === 0) {
      return {
        hasWhaleActivity: false,
        largestBets: [],
        marketLean: "NEUTRAL",
        momentum: "No significant activity",
        recommendation: "HOLD",
        confidence: "LOW",
        reasoning: "No trades to analyze",
      };
    }

    // Sort trades by size (largest first)
    const sortedTrades = [...trades].sort((a, b) => b.size - a.size);
    const largestBets = sortedTrades.slice(0, 5);

    // Calculate trade summary
    const yesBets = trades.filter((t) => 
      t.side === "BUY" && (t.outcome === "Yes" || t.outcome === null)
    );
    const noBets = trades.filter((t) => 
      t.side === "BUY" && t.outcome === "No"
    );
    
    const yesVolume = yesBets.reduce((sum, t) => sum + t.size * t.price, 0);
    const noVolume = noBets.reduce((sum, t) => sum + t.size * t.price, 0);
    const totalVolume = yesVolume + noVolume;

    // If AI is disabled, return basic analysis
    if (!this.aiEnabled || !this.client) {
      return this.createBasicAnalysis(trades, largestBets, yesVolume, noVolume, totalVolume);
    }

    const tradesSummary = largestBets
      .map((t) => {
        const value = t.size * t.price;
        const timeAgo = this.formatTimeAgo(t.timestamp);
        return `- $${value.toFixed(0)} on ${t.outcome ?? "unknown"} (${timeAgo})`;
      })
      .join("\n");

    const prompt = `You are a prediction market analyst specializing in whale trading patterns.

Market: ${market.question}
Current Odds: ${market.outcomes.map((o, i) => `${o}: ${(market.outcomePrices[i] ?? 0) * 100}%`).join(", ")}
Closes: ${market.endDate ? market.endDate.toISOString() : "Unknown"}

Recent Large Trades (>$50k):
${tradesSummary}

Volume Summary:
- YES side: $${yesVolume.toFixed(0)}
- NO side: $${noVolume.toFixed(0)}
- Net flow: $${(yesVolume - noVolume).toFixed(0)} toward ${yesVolume > noVolume ? "YES" : "NO"}

Whale Detection Signals to consider:
- Large bet size ($50k+)
- Bet timing relative to close
- Clustering of large bets
- Direction consensus

Analyze this activity and respond in JSON:
{
  "hasWhaleActivity": true/false,
  "marketLean": "YES" | "NO" | "NEUTRAL",
  "momentum": "e.g., +8% toward YES",
  "recommendation": "LEAN_YES" | "LEAN_NO" | "HOLD",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "reasoning": "Brief explanation of whale patterns and recommendation"
}`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0];
    if (!content || content.type !== "text") {
      throw new Error("Unexpected response type from Claude");
    }

    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        hasWhaleActivity: boolean;
        marketLean: "YES" | "NO" | "NEUTRAL";
        momentum: string;
        recommendation: "LEAN_YES" | "LEAN_NO" | "HOLD";
        confidence: "HIGH" | "MEDIUM" | "LOW";
        reasoning: string;
      };

      return {
        hasWhaleActivity: parsed.hasWhaleActivity ?? totalVolume > 100000,
        largestBets,
        marketLean: parsed.marketLean ?? "NEUTRAL",
        momentum: parsed.momentum ?? "No significant momentum",
        recommendation: parsed.recommendation ?? "HOLD",
        confidence: parsed.confidence ?? "LOW",
        reasoning: parsed.reasoning ?? "Unable to analyze",
      };
    } catch (error) {
      const errorText = content.type === "text" ? content.text : "unknown";
      console.error("[WhaleAnalyzer] Failed to parse response:", errorText);
      
      // Return a default analysis based on trade data
      return this.createBasicAnalysis(trades, largestBets, yesVolume, noVolume, totalVolume);
    }
  }

  /**
   * Format time ago string
   */
  private formatTimeAgo(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) {
      return `${diffMins} minutes ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hours ago`;
    } else {
      return `${diffDays} days ago`;
    }
  }
}
