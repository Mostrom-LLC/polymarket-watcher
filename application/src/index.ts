import { serve } from "inngest/express";
import { inngest, functions } from "./workflows/index.js";
import { getConfig } from "./config/loader.js";
import { getMarketCache } from "./cache/redis.js";
import { SlackNotifier } from "./notifications/slack.js";
import express from "express";
import type { Request, Response } from "express";

/**
 * Polymarket Watcher - Entry Point
 * 
 * This service monitors Polymarket prediction markets and provides
 * AI-powered analysis and alerts via Slack.
 */
async function main(): Promise<void> {
  // Load and validate configuration
  const config = getConfig();
  
  console.log(`[polymarket-watcher] Starting in ${config.env.NODE_ENV} mode`);
  console.log(`[polymarket-watcher] Watching ${config.user.markets.length} configured markets`);
  console.log(`[polymarket-watcher] Log level: ${config.env.LOG_LEVEL}`);
  
  // Initialize services for health checks
  const cache = getMarketCache(config.env.REDIS_URL);
  const slack = new SlackNotifier(
    config.env.SLACK_BOT_TOKEN,
    config.env.SLACK_DEFAULT_CHANNEL
  );
  
  // Create Express app
  const app = express();
  app.use(express.json());
  
  // Mount Inngest handler
  app.use(
    "/api/inngest",
    serve({
      client: inngest,
      functions,
    })
  );
  
  // Health check endpoint
  app.get("/health", async (_req: Request, res: Response) => {
    const [redisHealthy, slackHealthy] = await Promise.all([
      cache.healthCheck(),
      slack.healthCheck(),
    ]);
    
    const status = redisHealthy && slackHealthy ? "healthy" : "degraded";
    const statusCode = status === "healthy" ? 200 : 503;
    
    res.status(statusCode).json({
      status,
      timestamp: new Date().toISOString(),
      services: {
        redis: redisHealthy ? "up" : "down",
        slack: slackHealthy ? "up" : "down",
      },
    });
  });
  
  // Ready check (for k8s/ECS)
  app.get("/ready", async (_req: Request, res: Response) => {
    const redisHealthy = await cache.healthCheck();
    if (redisHealthy) {
      res.json({ ready: true });
    } else {
      res.status(503).json({ ready: false, reason: "redis_unavailable" });
    }
  });
  
  // Cache stats endpoint
  app.get("/stats", async (_req: Request, res: Response) => {
    try {
      const stats = await cache.getStats();
      res.json({
        cache: stats,
        config: {
          marketsConfigured: config.user.markets.length,
          pollingInterval: config.user.settings.pollingIntervalSeconds,
        },
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });
  
  // Start server
  const port = config.env.PORT;
  app.listen(port, () => {
    console.log(`[polymarket-watcher] Server listening on port ${port}`);
    console.log(`[polymarket-watcher] Inngest endpoint: http://localhost:${port}/api/inngest`);
    console.log(`[polymarket-watcher] Health: http://localhost:${port}/health`);
  });
}

main().catch((error) => {
  console.error("[polymarket-watcher] Fatal error:", error);
  process.exit(1);
});
