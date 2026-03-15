import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import {
  isBinaryYesNoMarket,
  isNoOutcomeLabel,
  isYesOutcomeLabel,
  type NormalizedMarket,
  type NormalizedTrade,
} from "../api/types.js";

export interface MarketVoteRecommendation {
  vote: "YES" | "NO" | "HOLD";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
}

export interface MarketSignalSummary {
  yesPrice: number;
  noPrice: number;
  priceSpread: number;
  minutesUntilClose: number | null;
  recentVolume: number;
  recentLiquidityRatio: number;
  yesRecentVolume: number;
  noRecentVolume: number;
  yesMomentumDelta: number;
  noMomentumDelta: number;
  largestRecentBets: NormalizedTrade[];
}

const marketVotePayloadSchema = z.object({
  vote: z.enum(["YES", "NO", "HOLD"]).optional(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  reasoning: z.string().optional(),
});

const marketVoteResponseSchema = {
  type: Type.OBJECT,
  properties: {
    vote: { type: Type.STRING, enum: ["YES", "NO", "HOLD"] },
    confidence: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW"] },
    reasoning: { type: Type.STRING },
  },
  required: ["vote", "confidence", "reasoning"],
};

function parseMarketVotePayload(rawText: string) {
  const trimmed = rawText.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.match(/\{[\s\S]*\}/)?.[0];

  if (!jsonText) {
    throw new Error("No JSON found in response");
  }

  try {
    return marketVotePayloadSchema.parse(JSON.parse(jsonText));
  } catch {
    const vote = jsonText.match(/"vote"\s*:\s*"(YES|NO|HOLD)"/)?.[1];
    const confidence = jsonText.match(/"confidence"\s*:\s*"(HIGH|MEDIUM|LOW)"/)?.[1];
    const reasoning = jsonText
      .match(/"reasoning"\s*:\s*"([\s\S]*)$/)?.[1]
      ?.replace(/["}\s]+$/, "")
      ?.trim();

    return marketVotePayloadSchema.parse({
      vote,
      confidence,
      reasoning,
    });
  }
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function outcomeVolumes(trades: NormalizedTrade[]) {
  return trades.reduce(
    (totals, trade) => {
      const value = trade.size * trade.price;
      if (isYesOutcomeLabel(trade.outcome)) {
        totals.yes += value;
      } else if (isNoOutcomeLabel(trade.outcome)) {
        totals.no += value;
      }
      return totals;
    },
    { yes: 0, no: 0 }
  );
}

function momentumDeltaForOutcome(trades: NormalizedTrade[], outcome: "Yes" | "No") {
  const outcomeTrades = trades
    .filter((trade) => outcome === "Yes" ? isYesOutcomeLabel(trade.outcome) : isNoOutcomeLabel(trade.outcome))
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

  if (outcomeTrades.length < 2) {
    return 0;
  }

  const midpoint = Math.max(1, Math.floor(outcomeTrades.length / 2));
  const earlierPrices = outcomeTrades.slice(0, midpoint).map((trade) => trade.price);
  const laterPrices = outcomeTrades.slice(midpoint).map((trade) => trade.price);

  return average(laterPrices) - average(earlierPrices);
}

export function summarizeMarketSignals(
  market: NormalizedMarket,
  trades: NormalizedTrade[]
): MarketSignalSummary {
  const yesIndex = market.outcomes.findIndex((outcome) => isYesOutcomeLabel(outcome));
  const noIndex = market.outcomes.findIndex((outcome) => isNoOutcomeLabel(outcome));
  const yesPrice = yesIndex >= 0 ? (market.outcomePrices[yesIndex] ?? 0) : 0;
  const noPrice = noIndex >= 0 ? (market.outcomePrices[noIndex] ?? Math.max(0, 1 - yesPrice)) : Math.max(0, 1 - yesPrice);
  const recentVolume = trades.reduce((sum, trade) => sum + trade.size * trade.price, 0);
  const { yes, no } = outcomeVolumes(trades);
  const minutesUntilClose = market.endDate
    ? Math.max(0, Math.round((market.endDate.getTime() - Date.now()) / (1000 * 60)))
    : null;

  return {
    yesPrice,
    noPrice,
    priceSpread: yesPrice - noPrice,
    minutesUntilClose,
    recentVolume,
    recentLiquidityRatio: market.liquidity > 0 ? recentVolume / market.liquidity : 0,
    yesRecentVolume: yes,
    noRecentVolume: no,
    yesMomentumDelta: momentumDeltaForOutcome(trades, "Yes"),
    noMomentumDelta: momentumDeltaForOutcome(trades, "No"),
    largestRecentBets: [...trades]
      .sort((left, right) => right.size * right.price - left.size * left.price)
      .slice(0, 3),
  };
}

export function fallbackRecommendationFromSignals(
  market: NormalizedMarket,
  signals: MarketSignalSummary
): MarketVoteRecommendation {
  const yesBias = signals.priceSpread + (signals.yesRecentVolume - signals.noRecentVolume) / 250000 + signals.yesMomentumDelta;
  const noBias = -signals.priceSpread + (signals.noRecentVolume - signals.yesRecentVolume) / 250000 + signals.noMomentumDelta;
  const lowSignal =
    Math.abs(signals.priceSpread) < 0.08 &&
    signals.recentVolume < 20000 &&
    Math.abs(signals.yesMomentumDelta - signals.noMomentumDelta) < 0.03;

  if (lowSignal) {
    return {
      vote: "HOLD",
      confidence: "LOW",
      reasoning: "The market is balanced and recent trading conviction is weak, so there is no clear edge right now.",
    };
  }

  const dominantVote = yesBias >= noBias ? "YES" : "NO";
  const dominantPrice = dominantVote === "YES" ? signals.yesPrice : signals.noPrice;
  const dominantVolume = dominantVote === "YES" ? signals.yesRecentVolume : signals.noRecentVolume;
  const trailingVolume = dominantVote === "YES" ? signals.noRecentVolume : signals.yesRecentVolume;
  const decisivePrice = dominantPrice >= 0.7;
  const decisiveVolume = dominantVolume >= Math.max(40000, trailingVolume * 1.5);
  const closesSoon = signals.minutesUntilClose !== null && signals.minutesUntilClose <= 60;

  return {
    vote: dominantVote,
    confidence: decisivePrice && decisiveVolume && closesSoon ? "HIGH" : decisivePrice || decisiveVolume ? "MEDIUM" : "LOW",
    reasoning:
      dominantVote === "YES"
        ? `YES has the stronger pricing signal at ${(signals.yesPrice * 100).toFixed(0)}% with ${signals.yesRecentVolume.toFixed(0)} in recent volume backing it.`
        : `NO has the stronger pricing signal at ${(signals.noPrice * 100).toFixed(0)}% with ${signals.noRecentVolume.toFixed(0)} in recent volume backing it.`,
  };
}

export class MarketRecommender {
  private client: GoogleGenAI;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(
    apiKey: string,
    options: { model?: string; maxTokens?: number; temperature?: number } = {}
  ) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = options.model ?? "gemini-2.5-flash";
    this.maxTokens = options.maxTokens ?? 512;
    this.temperature = options.temperature ?? 0.2;
  }

  async recommendVote(
    market: NormalizedMarket,
    trades: NormalizedTrade[]
  ): Promise<MarketVoteRecommendation> {
    if (!isBinaryYesNoMarket(market)) {
      return {
        vote: "HOLD",
        confidence: "LOW",
        reasoning: "This market uses multiple outcome buckets instead of a simple YES/NO structure, so the binary recommendation logic is intentionally skipped.",
      };
    }

    const signals = summarizeMarketSignals(market, trades);
    const fallback = fallbackRecommendationFromSignals(market, signals);

    const notableTrades = signals.largestRecentBets.length === 0
      ? "No recent trades available"
      : signals.largestRecentBets
          .map((trade) => {
            const value = (trade.size * trade.price).toFixed(0);
            const outcome = trade.outcome ?? "Unknown";
            return `- $${value} on ${outcome} at ${(trade.price * 100).toFixed(1)}%`;
          })
          .join("\n");

    const prompt = `You are analyzing a Polymarket market. Give a trading-style recommendation for whether a user should vote YES, vote NO, or HOLD/SKIP.

Market: ${market.question}
Current odds: YES ${(signals.yesPrice * 100).toFixed(1)}%, NO ${(signals.noPrice * 100).toFixed(1)}%
Volume: $${market.volume.toFixed(0)}
Liquidity: $${market.liquidity.toFixed(0)}
Time until close: ${signals.minutesUntilClose ?? "unknown"} minutes

Recent signal summary:
- Recent trade volume: $${signals.recentVolume.toFixed(0)}
- YES recent volume: $${signals.yesRecentVolume.toFixed(0)}
- NO recent volume: $${signals.noRecentVolume.toFixed(0)}
- YES momentum delta: ${(signals.yesMomentumDelta * 100).toFixed(1)} pts
- NO momentum delta: ${(signals.noMomentumDelta * 100).toFixed(1)} pts
- Recent volume / liquidity ratio: ${(signals.recentLiquidityRatio * 100).toFixed(1)}%

Largest recent bets:
${notableTrades}

Rules:
- Recommend YES or NO only when there is a clear edge.
- Recommend HOLD when the market is balanced, low-volume, or too noisy.
- Confidence should be HIGH, MEDIUM, or LOW.
- Reasoning must be 1-2 concise sentences and mention the strongest signal.
`;

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          maxOutputTokens: this.maxTokens,
          temperature: this.temperature,
          responseMimeType: "application/json",
          responseSchema: marketVoteResponseSchema,
        },
      });

      const parsed = parseMarketVotePayload(response.text ?? "");

      return {
        vote: parsed.vote ?? fallback.vote,
        confidence: parsed.confidence ?? fallback.confidence,
        reasoning: parsed.reasoning ?? fallback.reasoning,
      };
    } catch (error) {
      console.error("[MarketRecommender] Failed to generate recommendation:", error);
      return fallback;
    }
  }
}
