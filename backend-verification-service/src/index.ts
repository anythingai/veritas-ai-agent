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
import { createAuthMiddleware } from './middleware/auth';

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

// Interface for dependency injection
export interface ServiceDependencies {
  databaseService?: DatabaseService;
  embeddingService?: EmbeddingService;
  ipfsService?: IPFSService;
  validationService?: ValidationService;
  cacheService?: CacheService;
  metricsService?: MetricsService;
  verificationService?: VerificationService;
  logger?: any;
}

// Build function for testing with optional service injection
export const build = async (dependencies?: ServiceDependencies): Promise<FastifyInstance> => {
  // Use provided services or create new ones
  let databaseService = dependencies?.databaseService;
  let embeddingService = dependencies?.embeddingService;
  let ipfsService = dependencies?.ipfsService;
  let validationService = dependencies?.validationService;
  let cacheService = dependencies?.cacheService;
  let metricsService = dependencies?.metricsService;
  let verificationService = dependencies?.verificationService;
  const serviceLogger = dependencies?.logger || logger;

  if (!databaseService) {
    // Database connection
    const dbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    databaseService = new DatabaseService(dbPool, serviceLogger);
  }

  if (!embeddingService) {
    embeddingService = new EmbeddingService(serviceLogger);
  }

  if (!ipfsService) {
    ipfsService = new IPFSService(serviceLogger);
  }

  if (!validationService) {
    validationService = new ValidationService();
  }

  if (!cacheService) {
    cacheService = new CacheService(serviceLogger);
  }

  if (!metricsService) {
    metricsService = new MetricsService(serviceLogger, databaseService, cacheService);
  }

  if (!verificationService) {
    verificationService = new VerificationService(
      databaseService,
      embeddingService,
      ipfsService,
      metricsService,
      validationService,
      cacheService,
      serviceLogger
    );
  }

  // Create authentication middleware
  const authMiddleware = createAuthMiddleware(databaseService, serviceLogger);

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
      serviceLogger.error('Metrics endpoint error:', error);
      reply.status(500);
      return 'Error collecting metrics';
    }
  });

  // Middleware
  fastify.addHook('onRequest', requestLogger(serviceLogger));
  fastify.setErrorHandler(errorHandler(serviceLogger));

  // Apply authentication middleware to protected routes
  fastify.addHook('preHandler', async (request, reply) => {
    await authMiddleware(request, reply);
  });

  // Health check endpoint (unauthenticated)
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Check each service individually and handle failures gracefully
      const checkService = async (serviceCheck: () => Promise<boolean>): Promise<string> => {
        try {
          const result = await serviceCheck();
          return result ? 'healthy' : 'unhealthy';
        } catch (error) {
          return 'unhealthy';
        }
      };

      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.1.0',
        services: {
          database: await checkService(() => databaseService.healthCheck()),
          embedding: await checkService(() => embeddingService.healthCheck()),
          ipfs: await checkService(() => ipfsService.healthCheck())
        }
      };

      if (Object.values(health.services).some(status => status === 'unhealthy')) {
        health.status = 'degraded';
        reply.status(503);
      }

      return health;
    } catch (error) {
      serviceLogger.error('Health check failed:', error);
      reply.status(503);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        version: '1.1.0',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Add JSON Schema equivalents for Fastify route validation
  const verifyRequestJsonSchema = {
    type: 'object',
    required: ['claim_text'],
    properties: {
      claim_text: {
        type: 'string',
        minLength: 10,
        maxLength: 10000,
        description: 'The claim text to verify.'
      },
      source: {
        type: 'string',
        maxLength: 100,
        description: 'Source of the claim (e.g., browser-extension)',
        default: 'browser-extension'
      },
      timestamp: {
        type: 'string',
        format: 'date-time',
        description: 'ISO timestamp of the request'
      },
      extension_version: {
        type: 'string',
        maxLength: 50,
        description: 'Version of the browser extension',
      }
    },
    additionalProperties: false
  };

  const verificationResponseJsonSchema = {
    type: 'object',
    required: ['request_id', 'status', 'citations', 'processing_time_ms'],
    properties: {
      request_id: { type: 'string', description: 'Request UUID' },
      status: { type: 'string', enum: ['VERIFIED', 'UNVERIFIED', 'UNKNOWN', 'ERROR'], description: 'Verification status' },
      confidence: { type: ['number', 'null'], minimum: 0, maximum: 1, description: 'Confidence score' },
      citations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['doc_id', 'cid', 'title', 'snippet', 'similarity'],
          properties: {
            doc_id: { type: 'string', description: 'Document UUID' },
            cid: { type: 'string', description: 'IPFS CID' },
            title: { type: 'string', description: 'Document title' },
            snippet: { type: 'string', description: 'Relevant snippet' },
            similarity: { type: 'number', minimum: 0, maximum: 1, description: 'Similarity score' }
          }
        },
        description: 'Citations for the claim'
      },
      cached: { type: 'boolean', description: 'Whether the result was cached', default: false },
      processing_time_ms: { type: 'number', minimum: 0, description: 'Processing time in ms' },
      error: { type: 'string', description: 'Error message', nullable: true }
    }
  };

  // Main verification endpoint
  fastify.post('/verify', {
    schema: {
      body: verifyRequestJsonSchema,
      response: {
        200: verificationResponseJsonSchema,
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' }
          }
        },
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
        
        serviceLogger.info('Verification request received', {
          requestId,
          claimLength: claim_text.length,
          source,
          extensionVersion: extension_version,
          userId: (request as any).user.userId
        });

        // Check cache first
        const cachedResult = await cacheService.getCachedVerificationResult(claim_text);
        if (cachedResult && cachedResult.expiresAt > Date.now()) {
          // Add a type assertion for cachedResult
          const { status, confidence, citations } = cachedResult as { status: string; confidence: number; citations: any[] };
          serviceLogger.info('Cache hit', { requestId, cacheKey: claim_text });
          metricsService.recordCacheHit();
          
          return {
            request_id: requestId,
            status,
            confidence,
            citations,
            cached: true,
            processing_time_ms: Math.max(Date.now() - startTime, 1)
          };
        }

        // Perform verification
        const result = await verificationService.verifyClaim(claim_text, source);
        
                  // Cache the result
          await cacheService.cacheVerificationResult(claim_text, result, { ttl: 300 }); // 5 minutes
        
        // Store analytics
        await databaseService.storeVerificationRequest({
          id: requestId,
          claim_text,
          confidence: result.confidence,
          status: result.status,
          doc_ids: result.citations.map(c => c.doc_id),
          source,
          extension_version,
          processing_time_ms: Math.max(Date.now() - startTime, 1),
          created_at: new Date()
        });

        // Record metrics
        await metricsService.recordVerificationMetrics({
          claimLength: claim_text.length,
          documentsFound: result.citations.length,
          processingTimeMs: Math.max(Date.now() - startTime, 1),
          status: result.status,
          confidence: result.confidence
        });

        serviceLogger.info('Verification completed', {
          requestId,
          status: result.status,
          confidence: result.confidence,
          citationsCount: result.citations.length,
          processingTimeMs: Math.max(Date.now() - startTime, 1)
        });

        return {
          request_id: requestId,
          status: result.status,
          confidence: result.confidence,
          citations: result.citations,
          cached: false,
          processing_time_ms: Math.max(Date.now() - startTime, 1)
        };
        
      } catch (error) {
        const processingTime = Math.max(Date.now() - startTime, 1);
        serviceLogger.error('Verification failed', {
          requestId,
          error: error instanceof Error ? error.message : 'Unknown error',
          processingTime
        });
        
        metricsService.recordValidationError('verification', 'error');
        
        reply.status(500);
        return {
          request_id: requestId,
          status: 'ERROR',
          confidence: null,
          citations: [],
          cached: false,
          processing_time_ms: processingTime,
          error: error instanceof Error ? error.message : 'Internal server error'
        };
      }
    }
  });

  // Knowledge base management endpoints
  fastify.post('/documents', {
    handler: async (request, reply) => {
      try {
        const { title, content, mime_type, source_url } = request.body as any;
        
        if (!title || !content || !mime_type) {
          reply.status(400);
          return { error: 'Missing required fields: title, content, mime_type' };
        }
        
        const documentId = await verificationService.addDocument({
          title,
          content,
          mime_type,
          source_url
        });
        
        return { document_id: documentId };
      } catch (error) {
        serviceLogger.error('Document addition failed:', error);
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
        serviceLogger.error('Document retrieval failed:', error);
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
        serviceLogger.error('Analytics retrieval failed:', error);
        reply.status(500);
        return { error: 'Failed to retrieve analytics' };
      }
    }
  });

  return fastify;
};

// Create default production services
let defaultDatabaseService: DatabaseService | null = null;
let defaultEmbeddingService: EmbeddingService | null = null;
let defaultIPFSService: IPFSService | null = null;
let defaultCacheService: CacheService | null = null;
let defaultDbPool: Pool | null = null;

const createDefaultServices = () => {
  if (!defaultDbPool) {
    defaultDbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  if (!defaultDatabaseService) {
    defaultDatabaseService = new DatabaseService(defaultDbPool, logger);
  }

  if (!defaultEmbeddingService) {
    defaultEmbeddingService = new EmbeddingService(logger);
  }

  if (!defaultIPFSService) {
    defaultIPFSService = new IPFSService(logger);
  }

  if (!defaultCacheService) {
    defaultCacheService = new CacheService(logger);
  }

  return {
    databaseService: defaultDatabaseService,
    embeddingService: defaultEmbeddingService,
    ipfsService: defaultIPFSService,
    cacheService: defaultCacheService,
    dbPool: defaultDbPool
  };
};

// Start server
const start = async () => {
  try {
    const services = createDefaultServices();
    
    // Initialize services
    await services.databaseService.initialize();
    await services.embeddingService.initialize();
    await services.ipfsService.initialize();
    await services.cacheService.healthCheck();
    
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
      await services.dbPool.end();
      process.exit(0);
    });
    
    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down gracefully');
      await app.close();
      await services.dbPool.end();
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