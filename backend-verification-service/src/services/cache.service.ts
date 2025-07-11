import { Logger } from 'winston';
import { createClient, RedisClientType } from 'redis';

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string;
}

interface VerificationCacheData {
  status: 'VERIFIED' | 'UNVERIFIED' | 'UNKNOWN';
  confidence: number;
  citations: Array<{
    doc_id: string;
    cid: string;
    title: string;
    snippet: string;
    similarity: number;
  }>;
  cachedAt: number;
  expiresAt: number;
}

export class CacheService {
  private client: RedisClientType | null = null;
  private isConnected = false;
  private defaultTTL = 300; // 5 minutes
  private keyPrefix = 'veritas:';

  constructor(private logger: Logger) {
    this.initializeRedis();
  }

  private async initializeRedis(): Promise<void> {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      
      this.client = createClient({ url: redisUrl });

      this.client.on('error', (error) => {
        this.logger.error('Redis connection error:', error);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        this.logger.info('Redis connected successfully');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        this.logger.warn('Redis disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
    } catch (error) {
      this.logger.error('Failed to initialize Redis:', error);
      this.isConnected = false;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.client || !this.isConnected) {
        return false;
      }
      
      await this.client.ping();
      return true;
    } catch (error) {
      this.logger.error('Redis health check failed:', error);
      return false;
    }
  }

  private generateCacheKey(claimText: string, options?: { prefix?: string }): string {
    // Normalize claim text for consistent cache keys
    const normalizedText = claimText.toLowerCase().trim().replace(/\s+/g, ' ');
    
    // Create a hash of the normalized text
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(normalizedText).digest('hex').substring(0, 16);
    
    const prefix = options?.prefix || this.keyPrefix;
    return `${prefix}verification:${hash}`;
  }

  async cacheVerificationResult(
    claimText: string, 
    result: Omit<VerificationCacheData, 'cachedAt' | 'expiresAt'>,
    options?: CacheOptions
  ): Promise<boolean> {
    try {
      if (!this.client || !this.isConnected) {
        this.logger.warn('Redis not available for caching');
        return false;
      }

      const key = this.generateCacheKey(claimText, options);
      const ttl = options?.ttl || this.defaultTTL;
      const now = Date.now();

      const cacheData: VerificationCacheData = {
        ...result,
        cachedAt: now,
        expiresAt: now + (ttl * 1000)
      };

      await this.client.setEx(key, ttl, JSON.stringify(cacheData));
      
      this.logger.debug('Verification result cached', {
        key,
        ttl,
        claimLength: claimText.length,
        status: result.status
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to cache verification result:', error);
      return false;
    }
  }

  async getCachedVerificationResult(
    claimText: string,
    options?: CacheOptions
  ): Promise<VerificationCacheData | null> {
    try {
      if (!this.client || !this.isConnected) {
        return null;
      }

      const key = this.generateCacheKey(claimText, options);
      const cached = await this.client.get(key);

      if (!cached) {
        return null;
      }

      const cacheData: VerificationCacheData = JSON.parse(cached);
      
      // Check if cache has expired (double-check)
      if (Date.now() > cacheData.expiresAt) {
        await this.client.del(key);
        return null;
      }

      this.logger.debug('Cache hit for verification', {
        key,
        age: Date.now() - cacheData.cachedAt,
        status: cacheData.status
      });

      return cacheData;
    } catch (error) {
      this.logger.error('Failed to get cached verification result:', error);
      return null;
    }
  }

  async cacheDocumentEmbeddings(
    documentId: string,
    embeddings: number[][],
    options?: CacheOptions
  ): Promise<boolean> {
    try {
      if (!this.client || !this.isConnected) {
        return false;
      }

      const key = `${this.keyPrefix}embeddings:${documentId}`;
      const ttl = options?.ttl || 3600; // 1 hour for embeddings

      await this.client.setEx(key, ttl, JSON.stringify(embeddings));
      
      this.logger.debug('Document embeddings cached', {
        documentId,
        embeddingCount: embeddings.length,
        ttl
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to cache document embeddings:', error);
      return false;
    }
  }

  async getCachedDocumentEmbeddings(documentId: string): Promise<number[][] | null> {
    try {
      if (!this.client || !this.isConnected) {
        return null;
      }

      const key = `${this.keyPrefix}embeddings:${documentId}`;
      const cached = await this.client.get(key);

      if (!cached) {
        return null;
      }

      const embeddings: number[][] = JSON.parse(cached);
      
      this.logger.debug('Cache hit for document embeddings', {
        documentId,
        embeddingCount: embeddings.length
      });

      return embeddings;
    } catch (error) {
      this.logger.error('Failed to get cached document embeddings:', error);
      return null;
    }
  }

  async cacheApiKeyValidation(
    apiKey: string,
    validationResult: any,
    options?: CacheOptions
  ): Promise<boolean> {
    try {
      if (!this.client || !this.isConnected) {
        return false;
      }

      // Hash the API key for the cache key
      const crypto = require('crypto');
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 16);
      const key = `${this.keyPrefix}apikey:${keyHash}`;
      const ttl = options?.ttl || 300; // 5 minutes for API key validation

      await this.client.setEx(key, ttl, JSON.stringify(validationResult));
      
      this.logger.debug('API key validation cached', { keyHash, ttl });
      return true;
    } catch (error) {
      this.logger.error('Failed to cache API key validation:', error);
      return false;
    }
  }

  async getCachedApiKeyValidation(apiKey: string): Promise<any | null> {
    try {
      if (!this.client || !this.isConnected) {
        return null;
      }

      const crypto = require('crypto');
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 16);
      const key = `${this.keyPrefix}apikey:${keyHash}`;
      const cached = await this.client.get(key);

      if (!cached) {
        return null;
      }

      return JSON.parse(cached);
    } catch (error) {
      this.logger.error('Failed to get cached API key validation:', error);
      return null;
    }
  }

  async cacheSearchResults(
    queryEmbedding: number[],
    searchResults: any[],
    options?: CacheOptions
  ): Promise<boolean> {
    try {
      if (!this.client || !this.isConnected) {
        return false;
      }

      // Create cache key from query embedding hash
      const crypto = require('crypto');
      const embeddingHash = crypto.createHash('sha256')
        .update(JSON.stringify(queryEmbedding))
        .digest('hex')
        .substring(0, 16);
      
      const key = `${this.keyPrefix}search:${embeddingHash}`;
      const ttl = options?.ttl || 600; // 10 minutes for search results

      await this.client.setEx(key, ttl, JSON.stringify(searchResults));
      
      this.logger.debug('Search results cached', {
        embeddingHash,
        resultCount: searchResults.length,
        ttl
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to cache search results:', error);
      return false;
    }
  }

  async getCachedSearchResults(queryEmbedding: number[]): Promise<any[] | null> {
    try {
      if (!this.client || !this.isConnected) {
        return null;
      }

      const crypto = require('crypto');
      const embeddingHash = crypto.createHash('sha256')
        .update(JSON.stringify(queryEmbedding))
        .digest('hex')
        .substring(0, 16);
      
      const key = `${this.keyPrefix}search:${embeddingHash}`;
      const cached = await this.client.get(key);

      if (!cached) {
        return null;
      }

      const searchResults = JSON.parse(cached);
      
      this.logger.debug('Cache hit for search results', {
        embeddingHash,
        resultCount: searchResults.length
      });

      return searchResults;
    } catch (error) {
      this.logger.error('Failed to get cached search results:', error);
      return null;
    }
  }

  async invalidateVerificationCache(claimText?: string): Promise<boolean> {
    try {
      if (!this.client || !this.isConnected) {
        return false;
      }

      if (claimText) {
        // Invalidate specific cache entry
        const key = this.generateCacheKey(claimText);
        await this.client.del(key);
        this.logger.debug('Invalidated specific cache entry', { key });
      } else {
        // Invalidate all verification cache entries
        const pattern = `${this.keyPrefix}verification:*`;
        const keys = await this.client.keys(pattern);
        
        if (keys.length > 0) {
          await this.client.del(keys);
          this.logger.info('Invalidated verification cache', { keysRemoved: keys.length });
        }
      }

      return true;
    } catch (error) {
      this.logger.error('Failed to invalidate cache:', error);
      return false;
    }
  }

  async getCacheStats(): Promise<{
    isConnected: boolean;
    totalKeys: number;
    verificationKeys: number;
    embeddingKeys: number;
    searchKeys: number;
    memoryUsage?: string;
  }> {
    try {
      if (!this.client || !this.isConnected) {
        return {
          isConnected: false,
          totalKeys: 0,
          verificationKeys: 0,
          embeddingKeys: 0,
          searchKeys: 0
        };
      }

      const [verificationKeys, embeddingKeys, searchKeys, info] = await Promise.all([
        this.client.keys(`${this.keyPrefix}verification:*`),
        this.client.keys(`${this.keyPrefix}embeddings:*`),
        this.client.keys(`${this.keyPrefix}search:*`),
        this.client.info('memory')
      ]);

      const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
      const memoryUsage = memoryMatch ? memoryMatch[1] : undefined;

      return {
        isConnected: this.isConnected,
        totalKeys: verificationKeys.length + embeddingKeys.length + searchKeys.length,
        verificationKeys: verificationKeys.length,
        embeddingKeys: embeddingKeys.length,
        searchKeys: searchKeys.length,
        ...(memoryUsage && { memoryUsage })
      };
    } catch (error) {
      this.logger.error('Failed to get cache stats:', error);
      return {
        isConnected: this.isConnected,
        totalKeys: 0,
        verificationKeys: 0,
        embeddingKeys: 0,
        searchKeys: 0
      };
    }
  }

  async close(): Promise<void> {
    try {
      if (this.client) {
        await this.client.disconnect();
        this.isConnected = false;
        this.logger.info('Redis connection closed');
      }
    } catch (error) {
      this.logger.error('Error closing Redis connection:', error);
    }
  }
} 