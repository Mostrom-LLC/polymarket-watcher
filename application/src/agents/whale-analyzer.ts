import { Type } from "@google/genai";
import { z } from "zod";
import type { NormalizedMarket, NormalizedTrade } from "../api/types.js";
import { getGeminiClient } from "./gemini-client.js";

const whaleAnalysisPayloadSchema = z.object({
  hasWhaleActivity: z.boolean().optional(),
  marketLean: z.enum(["YES", "NO", "NEUTRAL"]).optional(),
  momentum: z.string().optional(),
  recommendation: z.enum(["LEAN_YES", "LEAN_NO", "HOLD"]).optional(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  reasoning: z.string().optional(),
});

const whaleAnalysisResponseSchema = {
  type: Type.OBJECT,
  properties: {
    hasWhaleActivity: { type: Type.BOOLEAN },
    marketLean: { type: Type.STRING, enum: ["YES", "NO", "NEUTRAL"] },
    momentum: { type: Type.STRING },
    recommendation: { type: Type.STRING, enum: ["LEAN_YES", "LEAN_NO", "HOLD"] },
    confidence: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW"] },
    reasoning: { type: Type.STRING },
  },
  required: [
    "hasWhaleActivity",
    "marketLean",
    "momentum",
    "recommendation",
    "confidence",
    "reasoning",
  ],
};

function parseWhaleAnalysisPayload(rawText: string) {
  const trimmed = rawText.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.match(/\{[\s\S]*\}/)?.[0];

  if (!jsonText) {
    throw new Error("No JSON found in response");
  }

  try {
    return whaleAnalysisPayloadSchema.parse(JSON.parse(jsonText));
  } catch {
    const hasWhaleActivity = jsonText.match(/"hasWhaleActivity"\s*:\s*(true|false)/)?.[1];
    const marketLean = jsonText.match(/"marketLean"\s*:\s*"(YES|NO|NEUTRAL)"/)?.[1];
    const momentum = jsonText.match(/"momentum"\s*:\s*"([^"]*)"/)?.[1];
    const recommendation = jsonText.match(/"recommendation"\s*:\s*"(LEAN_YES|LEAN_NO|HOLD)"/)?.[1];
    const confidence = jsonText.match(/"confidence"\s*:\s*"(HIGH|MEDIUM|LOW)"/)?.[1];
    const reasoning = jsonText
      .match(/"reasoning"\s*:\s*"([\s\S]*)$/)?.[1]
      ?.replace(/["}\s]+$/, "")
      ?.trim();

    return whaleAnalysisPayloadSchema.parse({
      hasWhaleActivity: hasWhaleActivity === "true" ? true : hasWhaleActivity === "false" ? false : undefined,
      marketLean,
      momentum,
      recommendation,
      confidence,
      reasoning,
    });
  }
}

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

export interface WhaleAnalyzerOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

interface ResolvedWhaleAnalyzerOptions {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

function resolveWhaleAnalyzerOptions(
  options: WhaleAnalyzerOptions
): ResolvedWhaleAnalyzerOptions {
  return {
    apiKey: options.apiKey,
    model: options.model ?? "gemini-2.5-flash",
    maxTokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.3,
  };
}

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 60) {
    return `${diffMins} minutes ago`;
  }

  if (diffHours < 24) {
    return `${diffHours} hours ago`;
  }

  return `${diffDays} days ago`;
}

export async function analyzeWhaleTrades(
  market: NormalizedMarket,
  trades: NormalizedTrade[],
  options: WhaleAnalyzerOptions
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

  const resolvedOptions = resolveWhaleAnalyzerOptions(options);
  const sortedTrades = [...trades].sort((a, b) => b.size - a.size);
  const largestBets = sortedTrades.slice(0, 5);
  const yesBets = trades.filter((trade) =>
    trade.side === "BUY" && (trade.outcome === "Yes" || trade.outcome === null)
  );
  const noBets = trades.filter((trade) =>
    trade.side === "BUY" && trade.outcome === "No"
  );
  const yesVolume = yesBets.reduce((sum, trade) => sum + trade.size * trade.price, 0);
  const noVolume = noBets.reduce((sum, trade) => sum + trade.size * trade.price, 0);
  const totalVolume = yesVolume + noVolume;
  const tradesSummary = largestBets
    .map((trade) => {
      const value = trade.size * trade.price;
      return `- $${value.toFixed(0)} on ${trade.outcome ?? "unknown"} (${formatTimeAgo(trade.timestamp)})`;
    })
    .join("\n");

  const prompt = `You are a prediction market analyst specializing in whale trading patterns.

Market: ${market.question}
Current Odds: ${market.outcomes.map((o, i) => `${o}: ${(market.outcomePrices[i] ?? 0) * 100}%`).join(", ")}
Closes: ${market.endDate ? market.endDate.toISOString() : "Unknown"}

Recent Whale Trades (>$10k):
${tradesSummary}

Volume Summary:
- YES side: $${yesVolume.toFixed(0)}
- NO side: $${noVolume.toFixed(0)}
- Net flow: $${(yesVolume - noVolume).toFixed(0)} toward ${yesVolume > noVolume ? "YES" : "NO"}

Whale Detection Signals to consider:
- Large bet size ($10k+)
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

  const response = await getGeminiClient(resolvedOptions.apiKey).models.generateContent({
    model: resolvedOptions.model,
    contents: prompt,
    config: {
      maxOutputTokens: resolvedOptions.maxTokens,
      temperature: resolvedOptions.temperature,
      responseMimeType: "application/json",
      responseSchema: whaleAnalysisResponseSchema,
    },
  });

  try {
    const parsed = parseWhaleAnalysisPayload(response.text ?? "");

    return {
      hasWhaleActivity: parsed.hasWhaleActivity ?? totalVolume > 100000,
      largestBets,
      marketLean: parsed.marketLean ?? "NEUTRAL",
      momentum: parsed.momentum ?? "No significant momentum",
      recommendation: parsed.recommendation ?? "HOLD",
      confidence: parsed.confidence ?? "LOW",
      reasoning: parsed.reasoning ?? "Unable to analyze",
    };
  } catch {
    console.error("[WhaleAnalyzer] Failed to parse response:", response.text ?? "unknown");
    return {
      hasWhaleActivity: totalVolume > 100000,
      largestBets,
      marketLean: yesVolume > noVolume * 1.2 ? "YES" : noVolume > yesVolume * 1.2 ? "NO" : "NEUTRAL",
      momentum: `$${Math.abs(yesVolume - noVolume).toFixed(0)} toward ${yesVolume > noVolume ? "YES" : "NO"}`,
      recommendation: "HOLD",
      confidence: "LOW",
      reasoning: "Analysis failed, using trade data fallback",
    };
  }
}
