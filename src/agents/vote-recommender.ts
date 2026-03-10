import { GoogleGenerativeAI } from "@google/generative-ai";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";

/**
 * Vote recommendation result
 */
export interface VoteRecommendation {
  recommendation: "VOTE_YES" | "VOTE_NO" | "HOLD";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
  formatted: string; // Pre-formatted for Slack display
}

/**
 * Vote Recommender Agent
 * 
 * Analyzes market data to provide vote recommendations using Gemini.
 * When no API key is provided, returns basic recommendations based on odds alone.
 */
export class VoteRecommender {
  private client: GoogleGenerativeAI | null;
  private model: string;
  private readonly aiEnabled: boolean;

  constructor(
    apiKey: string | undefined,
    options: { model?: string } = {}
  ) {
    this.aiEnabled = !!apiKey;
    this.client = apiKey ? new GoogleGenerativeAI(apiKey) : null;
    this.model = options.model ?? "gemini-2.0-flash";
  }

  /**
   * Check if AI analysis is enabled
   */
  isAiEnabled(): boolean {
    return this.aiEnabled;
  }

  /**
   * Generate a basic recommendation without AI (based on odds alone)
   */
  private createBasicRecommendation(market: NormalizedMarket): VoteRecommendation {
    const yesProbability = market.outcomePrices[0] ?? 0.5;
    const noProbability = market.outcomePrices[1] ?? 0.5;
    
    // Simple heuristic: if one side has > 70% odds, lean that way
    if (yesProbability >= 0.70) {
      return {
        recommendation: "VOTE_YES",
        confidence: yesProbability >= 0.85 ? "HIGH" : "MEDIUM",
        reasoning: `Market strongly favors YES at ${(yesProbability * 100).toFixed(0)}%.`,
        formatted: `Vote YES (${yesProbability >= 0.85 ? "High" : "Medium"} confidence)\nMarket strongly favors YES at ${(yesProbability * 100).toFixed(0)}%.`,
      };
    } else if (noProbability >= 0.70) {
      return {
        recommendation: "VOTE_NO",
        confidence: noProbability >= 0.85 ? "HIGH" : "MEDIUM",
        reasoning: `Market strongly favors NO at ${(noProbability * 100).toFixed(0)}%.`,
        formatted: `Vote NO (${noProbability >= 0.85 ? "High" : "Medium"} confidence)\nMarket strongly favors NO at ${(noProbability * 100).toFixed(0)}%.`,
      };
    } else {
      return {
        recommendation: "HOLD",
        confidence: "LOW",
        reasoning: `Market is too close to call (Yes ${(yesProbability * 100).toFixed(0)}% / No ${(noProbability * 100).toFixed(0)}%).`,
        formatted: `Hold/Skip (Low confidence)\nMarket is too close to call.`,
      };
    }
  }

  /**
   * Generate a vote recommendation for a market
   */
  async getRecommendation(
    market: NormalizedMarket,
    recentTrades?: NormalizedTrade[]
  ): Promise<VoteRecommendation> {
    // If AI is disabled, return basic recommendation
    if (!this.aiEnabled || !this.client) {
      return this.createBasicRecommendation(market);
    }

    const yesProbability = market.outcomePrices[0] ?? 0.5;
    const noProbability = market.outcomePrices[1] ?? 0.5;
    const hoursUntilClose = market.endDate 
      ? Math.max(0, (market.endDate.getTime() - Date.now()) / (1000 * 60 * 60))
      : null;

    // Calculate trade momentum if available
    let tradeMomentum = "";
    if (recentTrades && recentTrades.length > 0) {
      const yesBets = recentTrades.filter((t) => t.side === "BUY" && t.outcome === "Yes");
      const noBets = recentTrades.filter((t) => t.side === "BUY" && t.outcome === "No");
      const yesVolume = yesBets.reduce((sum, t) => sum + t.size * t.price, 0);
      const noVolume = noBets.reduce((sum, t) => sum + t.size * t.price, 0);
      tradeMomentum = `Recent large trades: $${yesVolume.toFixed(0)} on YES, $${noVolume.toFixed(0)} on NO`;
    }

    const prompt = `You are a prediction market analyst. Analyze this market and provide a voting recommendation.

Market Question: ${market.question}
Current Odds: Yes ${(yesProbability * 100).toFixed(1)}% / No ${(noProbability * 100).toFixed(1)}%
Volume: $${market.volume.toLocaleString()}
Liquidity: $${market.liquidity.toLocaleString()}
${hoursUntilClose !== null ? `Closes in: ${hoursUntilClose.toFixed(1)} hours` : ""}
${tradeMomentum}

Based on:
- Current odds distribution (market consensus)
- Volume/liquidity (market confidence)
- Time until close (opportunity window)
${tradeMomentum ? "- Recent large trade momentum" : ""}

Provide a recommendation in JSON format only (no markdown code blocks):
{
  "recommendation": "VOTE_YES" | "VOTE_NO" | "HOLD",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "reasoning": "1-2 sentence explanation"
}

Rules:
- VOTE_YES/VOTE_NO: Clear recommendation to bet on that outcome
- HOLD: Market too uncertain or poor risk/reward
- HIGH confidence: Strong market consensus (>75%) with good volume
- MEDIUM confidence: Moderate consensus (60-75%) or lower volume
- LOW confidence: Near 50/50 or very low volume`;

    try {
      const model = this.client.getGenerativeModel({ model: this.model });
      const response = await model.generateContent(prompt);
      const text = response.response.text();

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.createBasicRecommendation(market);
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        recommendation: "VOTE_YES" | "VOTE_NO" | "HOLD";
        confidence: "HIGH" | "MEDIUM" | "LOW";
        reasoning: string;
      };

      const recommendationText = parsed.recommendation === "VOTE_YES" 
        ? "Vote YES" 
        : parsed.recommendation === "VOTE_NO" 
          ? "Vote NO" 
          : "Hold/Skip";

      return {
        recommendation: parsed.recommendation,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
        formatted: `${recommendationText} (${parsed.confidence} confidence)\n${parsed.reasoning}`,
      };
    } catch (error) {
      console.error("[VoteRecommender] AI analysis failed:", error);
      return this.createBasicRecommendation(market);
    }
  }
}
