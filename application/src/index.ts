import { serve } from "inngest/express";
import { inngest, functions } from "./workflows/index.js";
import { getConfig } from "./config/loader.js";
import { getMarketCache } from "./cache/redis.js";
import { SlackNotifier } from "./notifications/slack.js";
import express from "express";
import type { Request, Response, RequestHandler, Application } from "express";
import { pathToFileURL } from "node:url";

interface AppConfig {
  env: {
    NODE_ENV: string;
    LOG_LEVEL: string;
    PORT?: number;
  };
  user: {
    markets: unknown[];
    settings: {
      pollingIntervalSeconds: number;
    };
  };
}

interface CacheService {
  healthCheck(): Promise<boolean>;
  getStats(): Promise<unknown>;
}

interface SlackService {
  healthCheck(): Promise<boolean>;
}

interface CreateAppOptions {
  config: AppConfig;
  cache: CacheService;
  slack: SlackService;
  inngestHandler?: RequestHandler;
}

/**
 * Polymarket Watcher - Entry Point
 * 
 * This service monitors Polymarket prediction markets and provides
 * AI-powered analysis and alerts via Slack.
 */
export function createApp(options: CreateAppOptions): Application {
  const { config, cache, slack, inngestHandler = serve({ client: inngest, functions }) } = options;

  const app = express();

  // Inngest needs a parsed JSON body, but its scheduler payloads can exceed
  // Express's default 100kb limit.
  app.use("/api/inngest", express.json({ limit: "5mb" }), inngestHandler);
  app.use(express.json());

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
    } catch {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  return app;
}

export async function main(): Promise<void> {
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
  const app = createApp({ config, cache, slack });

  // Start server
  const port = config.env.PORT;
  app.listen(port, () => {
    console.log(`[polymarket-watcher] Server listening on port ${port}`);
    console.log(`[polymarket-watcher] Inngest endpoint: http://localhost:${port}/api/inngest`);
    console.log(`[polymarket-watcher] Health: http://localhost:${port}/health`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[polymarket-watcher] Fatal error:", error);
    process.exit(1);
  });
}
