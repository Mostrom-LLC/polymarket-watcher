import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { 
  envConfigSchema, 
  userConfigSchema, 
  type EnvConfig, 
  type UserConfig 
} from "./schema.js";

/**
 * Configuration loading errors
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Load and validate environment configuration
 */
export function loadEnvConfig(): EnvConfig {
  const result = envConfigSchema.safeParse(process.env);
  
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Invalid environment configuration:\n${errors}`);
  }
  
  return result.data;
}

/**
 * Load and validate user configuration from YAML file
 */
export function loadUserConfig(configPath: string): UserConfig {
  const absolutePath = resolve(process.cwd(), configPath);
  
  if (!existsSync(absolutePath)) {
    console.warn(`Config file not found at ${absolutePath}, using defaults`);
    return userConfigSchema.parse({});
  }
  
  try {
    const fileContent = readFileSync(absolutePath, "utf-8");
    const rawConfig = parseYaml(fileContent);
    
    const result = userConfigSchema.safeParse(rawConfig);
    
    if (!result.success) {
      const errors = result.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");
      throw new ConfigError(`Invalid user configuration:\n${errors}`);
    }
    
    return result.data;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError(`Failed to load config from ${absolutePath}`, error);
  }
}

/**
 * Combined application configuration
 */
export interface AppConfig {
  env: EnvConfig;
  user: UserConfig;
}

/**
 * Load all application configuration
 */
export function loadConfig(): AppConfig {
  const env = loadEnvConfig();
  const user = loadUserConfig(env.CONFIG_PATH);
  
  return { env, user };
}

// Singleton config instance
let cachedConfig: AppConfig | null = null;

/**
 * Get the application configuration (loads once, caches result)
 */
export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * Reset cached configuration (useful for testing)
 */
export function resetConfig(): void {
  cachedConfig = null;
}
