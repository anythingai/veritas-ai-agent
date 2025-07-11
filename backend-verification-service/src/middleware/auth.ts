import { FastifyRequest, FastifyReply } from 'fastify';
import { DatabaseService } from '../services/database.service';
import { Logger } from 'winston';

export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    apiKey: string;
    userId: string;
    organization: string;
    permissions: string[];
    tier: string;
    rateLimit: number;
    dailyQuota: number;
    monthlyQuota: number;
      };
}

export class AuthMiddleware {
  constructor(
    private databaseService: DatabaseService,
    private logger: Logger
  ) {}

  async authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      // Skip auth for health check and metrics
      if (request.url === '/health' || request.url === '/metrics' || request.url === '/docs') {
        return;
      }

      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.status(401);
        return reply.send({
          error: 'Unauthorized',
          message: 'Missing or invalid Authorization header',
          code: 'MISSING_API_KEY'
        });
      }

      const apiKey = authHeader.slice(7); // Remove 'Bearer ' prefix

      // Validate API key format
      if (!this.isValidApiKeyFormat(apiKey)) {
        reply.status(401);
        return reply.send({
          error: 'Unauthorized',
          message: 'Invalid API key format',
          code: 'INVALID_API_KEY_FORMAT'
        });
      }

      // Lookup API key in database
      const apiKeyData = await this.databaseService.validateApiKey(apiKey);
      if (!apiKeyData) {
        this.logger.warn('Invalid API key attempted', { 
          apiKey: this.maskApiKey(apiKey),
          ip: request.ip,
          userAgent: request.headers['user-agent']
        });
        reply.status(401);
        return reply.send({
          error: 'Unauthorized',
          message: 'Invalid API key',
          code: 'INVALID_API_KEY'
        });
      }

      // Check if API key is active
      if (!apiKeyData.isActive) {
        this.logger.warn('Inactive API key attempted', { 
          apiKeyId: apiKeyData.id,
          userId: apiKeyData.userId 
        });
        reply.status(401);
        throw new Error('API key is inactive');
      }

      // Check if API key has expired
      if (apiKeyData.expiresAt && new Date() > apiKeyData.expiresAt) {
        this.logger.warn('Expired API key attempted', { 
          apiKeyId: apiKeyData.id,
          userId: apiKeyData.userId,
          expiresAt: apiKeyData.expiresAt
        });
        reply.status(401);
        throw new Error('API key has expired');
      }

      // Check daily and monthly quotas
      const usage = await this.databaseService.getApiKeyUsage(apiKeyData.id);
      if (usage.daily >= apiKeyData.dailyQuota) {
        this.logger.warn('Daily quota exceeded', { 
          apiKeyId: apiKeyData.id,
          dailyUsage: usage.daily,
          dailyQuota: apiKeyData.dailyQuota
        });
        reply.status(429);
        throw new Error('Daily quota exceeded');
      }

      if (usage.monthly >= apiKeyData.monthlyQuota) {
        this.logger.warn('Monthly quota exceeded', { 
          apiKeyId: apiKeyData.id,
          monthlyUsage: usage.monthly,
          monthlyQuota: apiKeyData.monthlyQuota
        });
        reply.status(429);
        throw new Error('Monthly quota exceeded');
      }

      // Update last used timestamp and increment usage
      await this.databaseService.incrementApiKeyUsage(apiKeyData.id);

      // Attach user data to request
      (request as AuthenticatedRequest).user = {
        apiKey: apiKey,
        userId: apiKeyData.userId,
        organization: apiKeyData.organization,
        permissions: apiKeyData.permissions,
        tier: apiKeyData.tier,
        rateLimit: apiKeyData.rateLimit,
        dailyQuota: apiKeyData.dailyQuota,
        monthlyQuota: apiKeyData.monthlyQuota
      };

      this.logger.debug('API key authenticated successfully', {
        userId: apiKeyData.userId,
        organization: apiKeyData.organization,
        tier: apiKeyData.tier
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      
      reply.status(reply.statusCode || 401);
      return reply.send({
        error: 'Unauthorized',
        message: errorMessage,
        code: 'AUTH_FAILED'
      });
    }
  }

  private isValidApiKeyFormat(apiKey: string): boolean {
    // API keys should be in format: veritas-{32-char-hex}
    const apiKeyRegex = /^veritas-[a-f0-9]{32}$/;
    return apiKeyRegex.test(apiKey);
}

  private maskApiKey(apiKey: string): string {
    if (apiKey.length < 8) return '***';
    return apiKey.substring(0, 8) + '***' + apiKey.substring(apiKey.length - 4);
    }
  }
  
// Factory function for creating auth middleware
export function createAuthMiddleware(databaseService: DatabaseService, logger: Logger) {
  const authMiddleware = new AuthMiddleware(databaseService, logger);
  return authMiddleware.authenticate.bind(authMiddleware);
} 