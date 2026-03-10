import { z } from "zod";

/**
 * Market threshold configuration schema
 */
export const marketThresholdsSchema = z.object({
  priceChangePercent: z.number().min(0).max(100).default(5),
  priceChangeMinutes: z.number().min(1).default(30),
  volumeThreshold: z.number().min(0).default(100000),
});

/**
 * Market analysis configuration schema
 */
export const marketAnalysisSchema = z.object({
  intervalMinutes: z.number().min(1).default(60),
  trendAnalysis: z.boolean().default(true),
  newsCorrelation: z.boolean().default(true),
});

/**
 * Individual market configuration schema
 */
export const marketConfigSchema = z.object({
  slug: z.string().min(1),
  enabled: z.boolean().default(true),
  thresholds: marketThresholdsSchema.optional(),
  analysis: marketAnalysisSchema.optional(),
});

/**
 * Notification settings schema
 */
export const notificationSettingsSchema = z.object({
  cooldownMinutes: z.number().min(0).default(15),
  includeAiSummary: z.boolean().default(true),
  mentionOnHighPriority: z.boolean().default(true),
});

/**
 * Global settings schema
 */
export const globalSettingsSchema = z.object({
  pollingIntervalSeconds: z.number().min(5).default(30),
  cacheTtlSeconds: z.number().min(1).default(60),
  maxConcurrentAnalyses: z.number().min(1).max(20).default(5),
  notifications: notificationSettingsSchema.default({}),
});

/**
 * AI settings schema
 */
export const aiSettingsSchema = z.object({
  model: z.string().default("claude-sonnet-4-20250514"),
  maxTokens: z.number().min(100).max(8192).default(1024),
  temperature: z.number().min(0).max(2).default(0.3),
});

/**
 * Root user configuration schema
 */
export const userConfigSchema = z.object({
  markets: z.array(marketConfigSchema).default([]),
  settings: globalSettingsSchema.default({}),
  ai: aiSettingsSchema.default({}),
});

/**
 * Environment configuration schema
 */
export const envConfigSchema = z.object({
  // Redis
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  
  // Inngest
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  
  // Anthropic (optional - AI features disabled when not provided)
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  
  // Slack
  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_DEFAULT_CHANNEL: z.string().default("polymarket-alerts"),
  
  // Application
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CONFIG_PATH: z.string().default("config/user-config.yaml"),
  PORT: z.coerce.number().min(1).max(65535).default(3000),
});

// Type exports
export type MarketThresholds = z.infer<typeof marketThresholdsSchema>;
export type MarketAnalysis = z.infer<typeof marketAnalysisSchema>;
export type MarketConfig = z.infer<typeof marketConfigSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type GlobalSettings = z.infer<typeof globalSettingsSchema>;
export type AISettings = z.infer<typeof aiSettingsSchema>;
export type UserConfig = z.infer<typeof userConfigSchema>;
export type EnvConfig = z.infer<typeof envConfigSchema>;
