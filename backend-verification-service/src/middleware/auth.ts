import { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { Logger } from 'winston';
import * as crypto from 'crypto';
import * as Redis from 'redis';
import { ValidationService } from '../services/validation.service';
import { DatabaseService } from '../services/database.service';
import { IncomingHttpHeaders } from 'http';

// Declare global type for rate limit store
declare global {
  var rateLimitStore: Map<string, { count: number; resetTime: number }> | undefined;
}

const validationService = new ValidationService();

export interface AuthenticatedRequest extends FastifyRequest {
  ip: string;
  user?: {
    apiKey: string;
    permissions: string[];
    rateLimit: number;
    userId?: string;
    organization?: string;
    tier?: string;
    quota?: {
      daily: number;
      monthly: number;
      used: {
        daily: number;
        monthly: number;
      };
    };
  };
  headers: Record<string, string | undefined>;
  url: string;
}

export const authMiddleware = (
  logger: Logger, 
  databaseService: DatabaseService,
  redisClient?: Redis.RedisClientType
) => {
  return async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;
      
      if (!authHeader) {
        logger.warn('Missing authorization header', {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          path: request.url
        });
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'API key required',
          code: 'MISSING_API_KEY'
        });
      }

      // Extract API key from Bearer token
      const apiKey = authHeader.replace(/^Bearer\s+/i, '');
      
      if (!apiKey) {
        logger.warn('Invalid authorization header format', {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          path: request.url
        });
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid API key format',
          code: 'INVALID_API_KEY_FORMAT'
        });
      }

      // Validate API key format
      if (!validationService.validateApiKey(apiKey)) {
        logger.warn('Invalid API key format', {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          path: request.url,
          apiKeyPrefix: apiKey.substring(0, 8) + '...'
        });
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid API key format',
          code: 'INVALID_API_KEY_FORMAT'
        });
      }

      // Check if API key is in the allowed list
      const validApiKeys = process.env.VALID_API_KEYS?.split(',') || [];
      
      if (!validApiKeys.includes(apiKey)) {
        logger.warn('Invalid API key', {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          path: request.url,
          apiKeyPrefix: apiKey.substring(0, 8) + '...'
        });
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid API key',
          code: 'INVALID_API_KEY'
        });
      }

      // Validate API key and get info
      const apiKeyInfo = await validateApiKey(apiKey, databaseService);
      if (!apiKeyInfo) {
        logger.warn('Invalid API key', {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          path: request.url,
          apiKeyPrefix: apiKey.substring(0, 8) + '...'
        });
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid API key',
          code: 'INVALID_API_KEY'
        });
      }

      // Check quota limits
      const quotaResult = await checkQuotaLimits(apiKeyInfo.id, apiKeyInfo.quota, databaseService);
      if (!quotaResult.allowed) {
        logger.warn('Quota limit exceeded', {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          path: request.url,
          apiKeyPrefix: apiKey.substring(0, 8) + '...',
          quotaType: quotaResult.exceededType,
          limit: quotaResult.limit,
          used: quotaResult.used
        });
        return reply.status(429).send({
          error: 'Quota Exceeded',
          message: `${quotaResult.exceededType} quota exceeded`,
          code: 'QUOTA_EXCEEDED',
          quota: {
            type: quotaResult.exceededType,
            limit: quotaResult.limit,
            used: quotaResult.used,
            resetTime: quotaResult.resetTime
          }
        });
      }

      // Check rate limiting
      const rateLimitResult = await checkRateLimit(apiKey, request.ip || 'unknown', apiKeyInfo.rateLimit, redisClient);
      if (!rateLimitResult.allowed) {
        logger.warn('Rate limit exceeded', {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          path: request.url,
          apiKeyPrefix: apiKey.substring(0, 8) + '...',
          limit: rateLimitResult.limit,
          remaining: rateLimitResult.remaining,
          resetTime: rateLimitResult.resetTime
        });
        return reply.status(429).send({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: rateLimitResult.retryAfter
        });
      }

      // Set user context
      request.user = {
        apiKey,
        permissions: apiKeyInfo.permissions,
        rateLimit: apiKeyInfo.rateLimit,
        userId: apiKeyInfo.userId,
        organization: apiKeyInfo.organization,
        tier: apiKeyInfo.tier,
        quota: {
          daily: quotaResult.limit.daily,
          monthly: quotaResult.limit.monthly,
          used: quotaResult.used
        }
      };

      // Add rate limit headers
      reply.header('X-RateLimit-Limit', rateLimitResult.limit);
      reply.header('X-RateLimit-Remaining', rateLimitResult.remaining);
      reply.header('X-RateLimit-Reset', rateLimitResult.resetTime);

      // Add quota headers
      reply.header('X-Quota-Daily-Limit', quotaResult.limit.daily.toString());
      reply.header('X-Quota-Daily-Used', quotaResult.used.daily.toString());
      reply.header('X-Quota-Monthly-Limit', quotaResult.limit.monthly.toString());
      reply.header('X-Quota-Monthly-Used', quotaResult.used.monthly.toString());

      // Log successful authentication
      logger.info('API key validated', {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        path: request.url,
        apiKeyPrefix: apiKey.substring(0, 8) + '...',
        permissions: apiKeyInfo.permissions,
        userId: apiKeyInfo.userId,
        organization: apiKeyInfo.organization,
        tier: apiKeyInfo.tier
      });

    } catch (error) {
      logger.error('Authentication error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        path: request.url
      });
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Authentication service unavailable',
        code: 'AUTH_SERVICE_ERROR'
      });
    }
  };
};

function isValidApiKeyFormat(apiKey: string): boolean {
  // Validate API key format: prefix-{32 character hash}
  const apiKeyPattern = /^[a-zA-Z0-9]+-[a-fA-F0-9]{32}$/;
  return apiKeyPattern.test(apiKey);
}

async function validateApiKey(apiKey: string, databaseService: DatabaseService): Promise<any> {
  try {
    const apiKeyData = await databaseService.validateApiKey(apiKey);
    
    if (!apiKeyData) {
      return null;
    }
    
    // Get current usage
    const usage = await databaseService.getApiKeyUsage(apiKeyData.id);
    
    return {
      id: apiKeyData.id,
      permissions: apiKeyData.permissions,
      rateLimit: apiKeyData.rateLimit,
      userId: apiKeyData.userId,
      organization: apiKeyData.organization,
      tier: apiKeyData.tier,
      quota: {
        daily: apiKeyData.dailyQuota,
        monthly: apiKeyData.monthlyQuota,
        used: usage
      },
      expiresAt: apiKeyData.expiresAt
    };
  } catch (error) {
    return null;
  }
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter: number;
}

async function checkRateLimit(apiKey: string, ip: string, rateLimit: number, redisClient?: Redis.RedisClientType): Promise<RateLimitResult> {
  const key = `rate_limit:${apiKey}:${ip}`;
  const window = 60; // 1 minute window
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / window) * window;
  
  if (redisClient) {
    try {
      // Use Redis for rate limiting
      const multi = redisClient.multi();
      const rateLimitKey = `${key}:${windowStart}`;
      
      multi.incr(rateLimitKey);
      multi.expire(rateLimitKey, window);
      
      const results = await multi.exec();
      const count = results?.[0] as number || 0;
      
      if (count > rateLimit) {
        return {
          allowed: false,
          limit: rateLimit,
          remaining: 0,
          resetTime: windowStart + window,
          retryAfter: windowStart + window - now
        };
      }
      
      return {
        allowed: true,
        limit: rateLimit,
        remaining: rateLimit - count,
        resetTime: windowStart + window,
        retryAfter: 0
      };
    } catch (error) {
      // Fall back to in-memory if Redis fails
      console.error('Redis rate limiting failed, falling back to in-memory:', error);
    }
  }
  
  // Fallback to in-memory storage (for development/testing)
  const rateLimitStore = global.rateLimitStore || new Map<string, { count: number; resetTime: number }>();
  if (!global.rateLimitStore) {
    global.rateLimitStore = rateLimitStore;
  }
  
  const current = rateLimitStore.get(key);
  if (!current || current.resetTime < now) {
    rateLimitStore.set(key, { count: 1, resetTime: windowStart + window });
    return {
      allowed: true,
      limit: rateLimit,
      remaining: rateLimit - 1,
      resetTime: windowStart + window,
      retryAfter: 0
    };
  }
  
  if (current.count >= rateLimit) {
    return {
      allowed: false,
      limit: rateLimit,
      remaining: 0,
      resetTime: current.resetTime,
      retryAfter: current.resetTime - now
    };
  }
  
  current.count++;
  return {
    allowed: true,
    limit: rateLimit,
    remaining: rateLimit - current.count,
    resetTime: current.resetTime,
    retryAfter: 0
  };
}

interface QuotaResult {
  allowed: boolean;
  limit: { daily: number; monthly: number };
  used: { daily: number; monthly: number };
  exceededType?: 'daily' | 'monthly';
  resetTime?: number;
}

async function checkQuotaLimits(apiKeyId: string, quota: { daily: number; monthly: number }, databaseService: DatabaseService): Promise<QuotaResult> {
  try {
    const usage = await databaseService.getApiKeyUsage(apiKeyId);
    
    if (usage.daily >= quota.daily) {
      return {
        allowed: false,
        limit: quota,
        used: usage,
        exceededType: 'daily',
        resetTime: new Date().setHours(24, 0, 0, 0)
      };
    }
    
    if (usage.monthly >= quota.monthly) {
      const now = new Date();
      return {
        allowed: false,
        limit: quota,
        used: usage,
        exceededType: 'monthly',
        resetTime: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
      };
    }
    
    // Increment usage
    await databaseService.incrementApiKeyUsage(apiKeyId);
    
    return {
      allowed: true,
      limit: quota,
      used: {
        daily: usage.daily + 1,
        monthly: usage.monthly + 1
      }
    };
  } catch (error) {
    throw error;
  }
}

function generateUserId(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 16);
}

function getOrganizationForApiKey(prefix: string): string {
  // This is now handled by the database
  return 'unknown';
}

export function requirePermission(permission: string) {
  return async (request: AuthenticatedRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
      return;
    }

    if (!request.user.permissions.includes(permission)) {
      reply.status(403).send({
        error: 'Forbidden',
        message: `Permission '${permission}' required`
      });
      return;
    }
  };
}

export function requireAnyPermission(permissions: string[]) {
  return async (request: AuthenticatedRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
      return;
    }

    const hasPermission = permissions.some(permission => 
      request.user!.permissions.includes(permission)
    );

    if (!hasPermission) {
      reply.status(403).send({
        error: 'Forbidden',
        message: `One of the following permissions required: ${permissions.join(', ')}`
      });
      return;
    }
  };
}

export function requireAllPermissions(permissions: string[]) {
  return async (request: AuthenticatedRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
      return;
    }

    const hasAllPermissions = permissions.every(permission => 
      request.user!.permissions.includes(permission)
    );

    if (!hasAllPermissions) {
      reply.status(403).send({
        error: 'Forbidden',
        message: `All of the following permissions required: ${permissions.join(', ')}`
      });
      return;
    }
  };
}

// Rate limiting middleware
export function createRateLimitMiddleware(maxRequests: number, windowMs: number) {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const key = typeof request.ip === 'string' ? request.ip : Array.isArray(request.ip) ? request.ip[0] : '';
    const now = Date.now();

    // Clean up expired entries
    for (const [k, v] of requests.entries()) {
      if (now > v.resetTime) {
        requests.delete(k);
      }
    }

    const userRequests = requests.get(key ?? '');
    
    if (!userRequests || now > userRequests.resetTime) {
      // First request or window expired
      requests.set(key ?? '', {
        count: 1,
        resetTime: now + windowMs
      });
    } else if (userRequests.count >= maxRequests) {
      // Rate limit exceeded
      reply.status(429).send({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${Math.ceil((userRequests.resetTime - now) / 1000)} seconds.`,
        retryAfter: Math.ceil((userRequests.resetTime - now) / 1000)
      });
      return;
    } else {
      // Increment request count
      userRequests.count++;
    }
  };
}

// IP whitelist middleware
export function createIpWhitelistMiddleware(allowedIps: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const clientIp = typeof request.ip === 'string' ? request.ip : Array.isArray(request.ip) ? request.ip[0] : '';
    
    if (!allowedIps.includes(clientIp ?? '') && !allowedIps.includes('*')) {
      reply.status(403).send({
        error: 'Forbidden',
        message: 'IP address not allowed'
      });
      return;
    }
  };
}

// Request logging middleware
export function createRequestLoggingMiddleware() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const startTime = Date.now();
    // Log request start here if needed
    // If you want to log on response, use a Fastify-level hook in your main server file
    // Remove reply.addHook usage
  };
} 