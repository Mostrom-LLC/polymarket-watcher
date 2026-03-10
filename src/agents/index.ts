/**
 * AI Analysis Agents
 * 
 * This module provides AI-powered analysis agents using Anthropic's Claude.
 * AI features are optional - when no ANTHROPIC_API_KEY is provided, agents
 * return pass-through or basic results based on trade data alone.
 */

export { TopicClassifier } from "./topic-classifier.js";
export type { ClassificationResult } from "./topic-classifier.js";

export { WhaleAnalyzer } from "./whale-analyzer.js";
export type { WhaleAnalysisResult } from "./whale-analyzer.js";

/**
 * Check if AI features are available (API key is configured)
 */
export function isAiAvailable(apiKey: string | undefined): boolean {
  return !!apiKey && apiKey.length > 0;
}
