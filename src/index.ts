import { serve } from "inngest/express";
import { inngest, functions } from "./workflows/index.js";
import { getConfig } from "./config/loader.js";
import express from "express";

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
  console.log(`[polymarket-watcher] Watching ${config.user.markets.length} markets`);
  
  // Create Express app for Inngest
  const app = express();
  
  // Mount Inngest handler
  app.use(
    "/api/inngest",
    serve({
      client: inngest,
      functions,
    })
  );
  
  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });
  
  // Start server
  const port = config.env.PORT;
  app.listen(port, () => {
    console.log(`[polymarket-watcher] Inngest server listening on port ${port}`);
    console.log(`[polymarket-watcher] Inngest endpoint: http://localhost:${port}/api/inngest`);
  });
}

main().catch((error) => {
  console.error("[polymarket-watcher] Fatal error:", error);
  process.exit(1);
});
