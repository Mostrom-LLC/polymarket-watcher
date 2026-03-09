/**
 * Redis Cache Layer
 * 
 * This module provides caching functionality using Redis.
 * Implementation will be added in subsequent tickets.
 */

import { Redis } from "ioredis";

export interface CacheOptions {
  ttlSeconds?: number;
}

/**
 * Redis cache wrapper with typed operations
 * TODO: Implement in subsequent ticket
 */
export class RedisCache {
  private client: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl);
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  }

  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    const serialized = JSON.stringify(value);
    if (options?.ttlSeconds) {
      await this.client.setex(key, options.ttlSeconds, serialized);
    } else {
      await this.client.set(key, serialized);
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}
