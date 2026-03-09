import Anthropic from "@anthropic-ai/sdk";
import type { NormalizedMarket } from "../api/types.js";

/**
 * Topic classification result
 */
export interface TopicClassification {
  market: NormalizedMarket;
  matchedTopics: string[];
  confidence: number;
  reasoning: string;
}

/**
 * Whale analysis result
 */
export interface WhaleAnalysis {
  marketId: string;
  summary: string;
  sentiment: "bullish" | "bearish" | "neutral";
  confidence: number;
  keyInsights: string[];
  recommendation: string;
}

/**
 * Topic Classifier Agent
 * 
 * Uses Claude to classify markets by topic relevance.
 */
export class TopicClassifier {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(
    apiKey: string,
    options: { model?: string; maxTokens?: number } = {}
  ) {
    this.client = new Anthropic({ apiKey });
    this.model = options.model ?? "claude-3-5-haiku-20241022";
    this.maxTokens = options.maxTokens ?? 512;
  }

  /**
   * Classify a market against a list of topics
   */
  async classifyMarket(
    market: NormalizedMarket,
    topics: string[]
  ): Promise<TopicClassification> {
    const prompt = `You are a market classification expert. Analyze this prediction market and determine which topics it matches.

Market Question: ${market.question}
Outcomes: ${market.outcomes.join(", ")}
Current Prices: ${market.outcomePrices.map((p, i) => `${market.outcomes[i]}: ${(p * 100).toFixed(1)}%`).join(", ")}

Topics to check: ${topics.join(", ")}

Respond in JSON format:
{
  "matchedTopics": ["topic1", "topic2"],
  "confidence": 0.85,
  "reasoning": "Brief explanation of why these topics match"
}

Only include topics that are genuinely relevant. Confidence should be 0-1 based on how clearly the market relates to the topics.`;

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
      // Extract JSON from the response
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        matchedTopics: string[];
        confidence: number;
        reasoning: string;
      };

      return {
        market,
        matchedTopics: parsed.matchedTopics ?? [],
        confidence: parsed.confidence ?? 0,
        reasoning: parsed.reasoning ?? "",
      };
    } catch (error) {
      const errorText = content.type === "text" ? content.text : "unknown";
      console.error("[TopicClassifier] Failed to parse response:", errorText);
      return {
        market,
        matchedTopics: [],
        confidence: 0,
        reasoning: "Failed to classify market",
      };
    }
  }

  /**
   * Batch classify multiple markets
   */
  async classifyMarkets(
    markets: NormalizedMarket[],
    topics: string[]
  ): Promise<TopicClassification[]> {
    const results: TopicClassification[] = [];

    for (const market of markets) {
      const classification = await this.classifyMarket(market, topics);
      results.push(classification);
      
      // Small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return results;
  }

  /**
   * Filter markets that match any of the given topics
   */
  async filterByTopics(
    markets: NormalizedMarket[],
    topics: string[],
    minConfidence: number = 0.5
  ): Promise<NormalizedMarket[]> {
    const classifications = await this.classifyMarkets(markets, topics);

    return classifications
      .filter((c) => c.matchedTopics.length > 0 && c.confidence >= minConfidence)
      .map((c) => c.market);
  }
}

/**
 * Whale Analysis Agent
 * 
 * Uses Claude to analyze large trade patterns and provide insights.
 */
export class WhaleAnalyzer {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(
    apiKey: string,
    options: { model?: string; maxTokens?: number } = {}
  ) {
    this.client = new Anthropic({ apiKey });
    this.model = options.model ?? "claude-sonnet-4-20250514";
    this.maxTokens = options.maxTokens ?? 1024;
  }

  /**
   * Analyze whale trading activity for a market
   */
  async analyzeWhaleActivity(
    marketQuestion: string,
    trades: Array<{
      side: "BUY" | "SELL";
      size: number;
      price: number;
      outcome: string | null;
      timestamp: Date;
    }>
  ): Promise<WhaleAnalysis> {
    const tradesSummary = trades
      .map((t) => {
        const value = t.size * t.price;
        return `- ${t.side} ${t.outcome ?? "unknown"}: $${value.toFixed(0)} at ${(t.price * 100).toFixed(1)}% (${t.timestamp.toISOString()})`;
      })
      .join("\n");

    const totalBuys = trades
      .filter((t) => t.side === "BUY")
      .reduce((sum, t) => sum + t.size * t.price, 0);
    const totalSells = trades
      .filter((t) => t.side === "SELL")
      .reduce((sum, t) => sum + t.size * t.price, 0);

    const prompt = `You are a prediction market analyst specializing in whale trading patterns.

Market: ${marketQuestion}

Recent Large Trades (>$50k):
${tradesSummary}

Total Buy Volume: $${totalBuys.toFixed(0)}
Total Sell Volume: $${totalSells.toFixed(0)}
Net Flow: $${(totalBuys - totalSells).toFixed(0)}

Analyze this whale activity and provide:
1. A brief summary of what the whales are doing
2. The overall sentiment (bullish/bearish/neutral)
3. Your confidence in this assessment (0-1)
4. Key insights about the trading patterns
5. A recommendation for someone watching this market

Respond in JSON format:
{
  "summary": "Brief analysis",
  "sentiment": "bullish" | "bearish" | "neutral",
  "confidence": 0.75,
  "keyInsights": ["insight1", "insight2"],
  "recommendation": "What to watch for"
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
        summary: string;
        sentiment: "bullish" | "bearish" | "neutral";
        confidence: number;
        keyInsights: string[];
        recommendation: string;
      };

      return {
        marketId: "",
        summary: parsed.summary ?? "Unable to analyze",
        sentiment: parsed.sentiment ?? "neutral",
        confidence: parsed.confidence ?? 0,
        keyInsights: parsed.keyInsights ?? [],
        recommendation: parsed.recommendation ?? "",
      };
    } catch (error) {
      const errorText = content.type === "text" ? content.text : "unknown";
      console.error("[WhaleAnalyzer] Failed to parse response:", errorText);
      return {
        marketId: "",
        summary: "Analysis failed",
        sentiment: "neutral",
        confidence: 0,
        keyInsights: [],
        recommendation: "Unable to provide recommendation",
      };
    }
  }
}
