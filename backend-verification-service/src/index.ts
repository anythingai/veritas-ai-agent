import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import dotenv from 'dotenv';
import { VerificationService } from './services/verification.service';
import { DatabaseService } from './services/database.service';
import { EmbeddingService } from './services/embedding.service';
import { IPFSService } from './services/ipfs.service';
import { MetricsService } from './services/metrics.service';
import { ValidationService } from './services/validation.service';
import { CacheService } from './services/cache.service';
import { verifyRequestSchema, verificationResponseSchema } from './schemas/verification.schema';
import { errorHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { authMiddleware } from './middleware/auth';

// Load environment variables
dotenv.config();

// Configure logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'veritas-verification-service' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Database connection
const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Initialize services
const databaseService = new DatabaseService(dbPool, logger);
const embeddingService = new EmbeddingService(logger);
const ipfsService = new IPFSService(logger);
const metricsService = new MetricsService(logger);
const validationService = new ValidationService();
const cacheService = new CacheService(logger);

const verificationService = new VerificationService(
  databaseService,
  embeddingService,
  ipfsService,
  metricsService,
  validationService,
  cacheService,
  logger
);

// Build function for testing
export const build = async (): Promise<FastifyInstance> => {
  // Create Fastify instance
  const fastify: FastifyInstance = Fastify({
    logger: false, // We're using Winston instead
    trustProxy: true,
    bodyLimit: 1048576, // 1MB
  });

  // Register plugins
  fastify.register(cors, {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  });

  fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  });

  fastify.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX || '50'),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '1000'),
    allowList: process.env.RATE_LIMIT_ALLOWLIST?.split(',') || [],
    keyGenerator: (request) => {
      return String(request.ip || request.headers['x-forwarded-for'] || 'unknown');
    },
    errorResponseBuilder: (request, context) => {
      return {
        code: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded, retry in ${context.after}`,
        retryAfter: context.after
      };
    }
  });

  // Swagger documentation
  fastify.register(swagger, {
    swagger: {
      info: {
        title: 'Veritas AI Agent API',
        description: 'Real-time fact verification service',
        version: '1.1.0'
      },
      host: process.env.API_HOST || 'localhost:8080',
      schemes: ['https', 'http'],
      consumes: ['application/json'],
      produces: ['application/json'],
      securityDefinitions: {
        apiKey: {
          type: 'apiKey',
          name: 'Authorization',
          in: 'header'
        }
      }
    }
  });

  fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true
    }
  });

  // Metrics endpoint
  fastify.get('/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const metrics = await metricsService.getMetrics();
      reply.type('text/plain');
      return metrics;
    } catch (error) {
      logger.error('Metrics endpoint error:', error);
      reply.status(500);
      return 'Error collecting metrics';
    }
  });

  // Middleware
  fastify.addHook('onRequest', requestLogger(logger));
  fastify.setErrorHandler(errorHandler(logger));

  // Health check endpoint
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Check database connection
      await databaseService.healthCheck();
      
      // Check external services
      const [embeddingResult, ipfsResult] = await Promise.allSettled([
        embeddingService.healthCheck(),
        ipfsService.healthCheck()
      ]);
      
      const healthy = embeddingResult.status === 'fulfilled' && ipfsResult.status === 'fulfilled';
      
      return {
        status: healthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        version: '1.1.0',
        services: {
          database: 'healthy',
          embedding: embeddingResult.status === 'fulfilled' ? 'healthy' : 'unhealthy',
          ipfs: ipfsResult.status === 'fulfilled' ? 'healthy' : 'unhealthy'
        }
      };
    } catch (error) {
      logger.error('Health check failed:', error);
      reply.status(503);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Service unavailable'
      };
    }
  });

  // Main verification endpoint
  fastify.post('/verify', {
    schema: {
      body: verifyRequestSchema,
      response: {
        200: verificationResponseSchema,
        500: {
          type: 'object',
          properties: {
            request_id: { type: 'string' },
            status: { type: 'string' },
            error: { type: 'string' },
            processing_time_ms: { type: 'number' }
          }
        }
      }
    },
    handler: async (request, reply) => {
      const startTime = Date.now();
      const requestId = uuidv4();
      
      try {
        const { claim_text, source, timestamp, extension_version } = request.body as any;
        
        logger.info('Verification request received', {
          requestId,
          claimLength: claim_text.length,
          source,
          extensionVersion: extension_version
        });

        // Check cache first
        const cacheKey = verificationService.generateCacheKey(claim_text);
        const cachedResult = await cacheService.get(cacheKey);
        
        if (cachedResult) {
          // Add a type assertion for cachedResult
          const { status, confidence, citations } = cachedResult as { status: string; confidence: number; citations: any[] };
          logger.info('Cache hit', { requestId, cacheKey });
          metricsService.recordCacheHit();
          
          return {
            request_id: requestId,
            status,
            confidence,
            citations,
            cached: true,
            processing_time_ms: Date.now() - startTime
          };
        }

        // Perform verification
        const result = await verificationService.verifyClaim(claim_text, source);
        
        // Cache the result
        await cacheService.set(cacheKey, result, { ttl: 300 }); // 5 minutes
        
        // Store analytics
        await databaseService.storeVerificationRequest({
          id: requestId,
          claim_text,
          confidence: result.confidence,
          status: result.status,
          doc_ids: result.citations.map(c => c.doc_id),
          source,
          extension_version,
          processing_time_ms: Date.now() - startTime,
          created_at: new Date()
        });

        // Record metrics
        metricsService.recordVerificationRequest(result.status, Date.now() - startTime);
        
        logger.info('Verification completed', {
          requestId,
          status: result.status,
          confidence: result.confidence,
          citationsCount: result.citations.length,
          processingTimeMs: Date.now() - startTime
        });

        return {
          request_id: requestId,
          status: result.status,
          confidence: result.confidence,
          citations: result.citations,
          cached: false,
          processing_time_ms: Date.now() - startTime
        };
        
      } catch (error) {
        logger.error('Verification failed', {
          requestId,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined
        });
        
        metricsService.recordValidationError('verification', 'error');
        
        reply.status(500);
        return {
          request_id: requestId,
          status: 'ERROR',
          error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error instanceof Error ? error.message : 'Unknown error',
          processing_time_ms: Date.now() - startTime
        };
      }
    }
  });

  // Knowledge base management endpoints
  fastify.post('/documents', {
    handler: async (request, reply) => {
      try {
        const { title, content, mime_type, source_url } = request.body as any;
        
        const documentId = await verificationService.addDocument({
          title,
          content,
          mime_type,
          source_url
        });
        
        return { document_id: documentId };
      } catch (error) {
        logger.error('Document addition failed:', error);
        reply.status(500);
        return { error: 'Failed to add document' };
      }
    }
  });

  fastify.get('/documents', {
    handler: async (request, reply) => {
      try {
        const { page = 1, limit = 20 } = request.query as any;
        const documents = await databaseService.getDocuments(page, limit);
        return documents;
      } catch (error) {
        logger.error('Document retrieval failed:', error);
        reply.status(500);
        return { error: 'Failed to retrieve documents' };
      }
    }
  });

  // Analytics endpoints
  fastify.get('/analytics/verifications', {
    handler: async (request, reply) => {
      try {
        const { start_date, end_date, source } = request.query as any;
        const analytics = await databaseService.getVerificationAnalytics(start_date, end_date, source);
        return analytics;
      } catch (error) {
        logger.error('Analytics retrieval failed:', error);
        reply.status(500);
        return { error: 'Failed to retrieve analytics' };
      }
    }
  });

  return fastify;
};

// Start server
const start = async () => {
  try {
    // Initialize services
    await databaseService.initialize();
    await embeddingService.initialize();
    await ipfsService.initialize();
    await cacheService.initialize();
    
    const app = await build();
    
    const port = parseInt(process.env.PORT || '8080');
    const host = process.env.HOST || '0.0.0.0';
    
    await app.listen({ port, host });
    
    logger.info(`Veritas verification service listening on ${host}:${port}`);
    logger.info(`Swagger documentation available at http://${host}:${port}/docs`);
    logger.info(`Metrics available at http://${host}:${port}/metrics`);
    
    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully');
      await app.close();
      await dbPool.end();
      process.exit(0);
    });
    
    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down gracefully');
      await app.close();
      await dbPool.end();
      process.exit(0);
    });
    
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

// Only start the server if this file is run directly
if (require.main === module) {
  start();
} 