import { Logger } from 'winston';
import { createClient } from 'redis';

export interface CacheOptions {
  ttl?: number;
}

export class CacheService {
  private redisClient: ReturnType<typeof createClient>;
  private logger: Logger;
  private defaultTTL: number;

  constructor(logger: Logger) {
    this.logger = logger;
    this.defaultTTL = parseInt(process.env.CACHE_TTL || '300'); // 5 minutes default
    
    this.redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            this.logger.error('Redis connection failed after 10 retries');
            return new Error('Redis connection failed');
          }
          return Math.min(retries * 50, 500);
        }
      }
    });

    this.redisClient.on('error', (err) => {
      this.logger.error('Redis client error:', err);
    });

    this.redisClient.on('connect', () => {
      this.logger.info('Redis client connected');
    });

    this.redisClient.on('ready', () => {
      this.logger.info('Redis client ready');
    });

    this.redisClient.on('end', () => {
      this.logger.info('Redis client disconnected');
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.redisClient.connect();
      
      // Test connection
      await this.redisClient.ping();
      
      this.logger.info('Cache service initialized successfully');
    } catch (error) {
      this.logger.error('Cache service initialization failed:', error);
      throw error;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redisClient.get(key);
      if (!value) {
        return null;
      }
      
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error('Cache get failed:', error);
      return null;
    }
  }

  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    try {
      const ttl = options?.ttl || this.defaultTTL;
      const serializedValue = JSON.stringify(value);
      
      await this.redisClient.setEx(key, ttl, serializedValue);
    } catch (error) {
      this.logger.error('Cache set failed:', error);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redisClient.del(key);
    } catch (error) {
      this.logger.error('Cache delete failed:', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      await this.redisClient.flushDb();
      this.logger.info('Cache cleared');
    } catch (error) {
      this.logger.error('Cache clear failed:', error);
      throw error;
    }
  }

  async getSize(): Promise<number> {
    try {
      const info = await this.redisClient.info('keyspace');
      const lines = info.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('db0:')) {
          const match = line.match(/keys=(\d+)/);
          if (match) {
            return parseInt(match[1] || '0');
          }
        }
      }
      
      return 0;
    } catch (error) {
      this.logger.error('Cache size check failed:', error);
      return 0;
    }
  }

  async getStats(): Promise<{
    hits: number;
    misses: number;
    hitRate: number;
  }> {
    try {
      const info = await this.redisClient.info('stats');
      const lines = info.split('\n');
      
      let hits = 0;
      let misses = 0;
      
      for (const line of lines) {
        if (line.startsWith('keyspace_hits:')) {
          hits = parseInt(line.split(':')[1] || '0');
        } else if (line.startsWith('keyspace_misses:')) {
          misses = parseInt(line.split(':')[1] || '0');
        }
      }
      
      const total = hits + misses;
      const hitRate = total > 0 ? hits / total : 0;
      
      return {
        hits,
        misses,
        hitRate
      };
    } catch (error) {
      this.logger.error('Cache stats failed:', error);
      return {
        hits: 0,
        misses: 0,
        hitRate: 0
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.redisClient.ping();
      return true;
    } catch (error) {
      this.logger.error('Cache health check failed:', error);
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      await this.redisClient.quit();
      this.logger.info('Cache service closed');
    } catch (error) {
      this.logger.error('Cache service close failed:', error);
    }
  }
} 