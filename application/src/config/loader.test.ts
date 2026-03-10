import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadUserConfig, loadEnvConfig, resetConfig, ConfigError } from "./loader.js";
import { writeFileSync, unlinkSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("Config Loader", () => {
  const testConfigDir = join(process.cwd(), "test-config");
  const testConfigPath = join(testConfigDir, "test-config.yaml");

  beforeEach(() => {
    resetConfig();
    if (!existsSync(testConfigDir)) {
      mkdirSync(testConfigDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
  });

  describe("loadUserConfig", () => {
    it("should return defaults when config file does not exist", () => {
      const config = loadUserConfig("nonexistent.yaml");
      
      expect(config.markets).toEqual([]);
      expect(config.settings.pollingIntervalSeconds).toBe(30);
      expect(config.ai.model).toBe("claude-sonnet-4-20250514");
    });

    it("should load and validate YAML config", () => {
      const yamlContent = `
markets:
  - slug: "test-market"
    enabled: true
    thresholds:
      priceChangePercent: 10
settings:
  pollingIntervalSeconds: 60
ai:
  model: "claude-opus-4-20250514"
`;
      writeFileSync(testConfigPath, yamlContent);

      const config = loadUserConfig(testConfigPath);

      expect(config.markets).toHaveLength(1);
      expect(config.markets[0]?.slug).toBe("test-market");
      expect(config.markets[0]?.thresholds?.priceChangePercent).toBe(10);
      expect(config.settings.pollingIntervalSeconds).toBe(60);
      expect(config.ai.model).toBe("claude-opus-4-20250514");
    });

    it("should apply defaults for missing optional fields", () => {
      const yamlContent = `
markets:
  - slug: "minimal-market"
`;
      writeFileSync(testConfigPath, yamlContent);

      const config = loadUserConfig(testConfigPath);

      expect(config.markets[0]?.enabled).toBe(true);
      expect(config.settings.cacheTtlSeconds).toBe(60);
      expect(config.ai.temperature).toBe(0.3);
    });

    it("should throw ConfigError for invalid config", () => {
      const yamlContent = `
markets:
  - slug: ""
`;
      writeFileSync(testConfigPath, yamlContent);

      expect(() => loadUserConfig(testConfigPath)).toThrow(ConfigError);
    });
  });

  describe("loadEnvConfig", () => {
    it("should throw ConfigError when required env vars are missing", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("SLACK_BOT_TOKEN", "");

      expect(() => loadEnvConfig()).toThrow(ConfigError);
    });

    it("should load valid env config", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
      vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
      vi.stubEnv("REDIS_URL", "redis://localhost:6380");
      vi.stubEnv("PORT", "4000");

      const config = loadEnvConfig();

      expect(config.ANTHROPIC_API_KEY).toBe("sk-ant-test");
      expect(config.SLACK_BOT_TOKEN).toBe("xoxb-test");
      expect(config.REDIS_URL).toBe("redis://localhost:6380");
      expect(config.PORT).toBe(4000);
    });

    it("should apply defaults for optional env vars", () => {
      // Clear any existing env vars first
      vi.stubEnv("NODE_ENV", undefined as unknown as string);
      vi.stubEnv("LOG_LEVEL", undefined as unknown as string);
      vi.stubEnv("PORT", undefined as unknown as string);
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
      vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");

      const config = loadEnvConfig();

      expect(config.NODE_ENV).toBe("development");
      expect(config.LOG_LEVEL).toBe("info");
      expect(config.PORT).toBe(3000);
    });
  });
});
