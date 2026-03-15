import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "./index.js";

describe("createApp", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      server = null;
    }
  });

  it("allows large Inngest payloads without tripping the global JSON body limit", async () => {
    const inngestHandler = express.Router();
    const handlerSpy = vi.fn((_req, res) => {
      res.status(204).end();
    });
    inngestHandler.post("/", handlerSpy);

    const app = createApp({
      config: {
        env: {
          NODE_ENV: "test",
          LOG_LEVEL: "info",
        },
        user: {
          markets: [],
          settings: {
            pollingIntervalSeconds: 60,
          },
        },
      },
      cache: {
        healthCheck: async () => true,
        getStats: async () => ({ keys: 0 }),
      },
      slack: {
        healthCheck: async () => true,
      },
      inngestHandler,
    });

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));

    const port = (server.address() as AddressInfo).port;
    const largeBody = JSON.stringify({
      data: "x".repeat(150_000),
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/inngest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: largeBody,
    });

    expect(response.status).toBe(204);
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });
});
