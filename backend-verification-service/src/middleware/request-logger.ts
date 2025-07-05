import { FastifyRequest, FastifyReply } from 'fastify';
import { Logger } from 'winston';
import { v4 as uuidv4 } from 'uuid';

export interface LoggedRequest extends FastifyRequest {
  requestId: string;
  startTime: number;
  performanceData?: {
    dbQueries: number;
    externalCalls: number;
    cacheHits: number;
    cacheMisses: number;
  };
  method: string;
  url: string;
  ip: string;
  headers: Record<string, string | undefined>;
  query: Record<string, string>;
  body: any;
}

export const requestLogger = (logger: Logger) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Generate request ID
    const requestId = request.headers['x-request-id'] as string || uuidv4();
    (request as any).requestId = requestId;
    (request as any).startTime = Date.now();
    (request as any).performanceData = {
      dbQueries: 0,
      externalCalls: 0,
      cacheHits: 0,
      cacheMisses: 0
    };

    // Add request ID to response headers
    reply.header('X-Request-ID', requestId);

    // Log request start with enhanced context
    logger.info('Request started', {
      requestId,
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      contentType: request.headers['content-type'],
      contentLength: request.headers['content-length'],
      referer: request.headers['referer'],
      origin: request.headers['origin'],
      timestamp: new Date().toISOString(),
      user: (request as any).user ? {
        userId: (request as any).user.userId,
        organization: (request as any).user.organization,
        permissions: (request as any).user.permissions
      } : undefined
    });
  };
};

// Performance monitoring middleware
export const performanceMonitor = (logger: Logger) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = process.hrtime.bigint();
    // Implementation would go here
  };
};

// Security logging middleware
export const securityLogger = (logger: Logger) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Log potential security issues
    const suspiciousPatterns = [
      /\.\.\//, // Directory traversal
      /<script/i, // XSS attempts
      /union\s+select/i, // SQL injection
      /eval\s*\(/i, // Code injection
      /document\.cookie/i, // Cookie theft attempts
      /javascript:/i, // JavaScript protocol
      /vbscript:/i, // VBScript protocol
      /data:text\/html/i, // Data URI attacks
      /on\w+\s*=/i, // Event handler injection
      /<iframe/i, // Iframe injection
      /<object/i, // Object injection
      /<embed/i, // Embed injection
    ];

    const userAgent = request.headers['user-agent'] || '';
    const url = request.url;
    const body = request.body as string || '';
    const query = request.query as Record<string, string> || {};

    // Check for suspicious patterns
    const suspiciousFound = suspiciousPatterns.some(pattern => 
      pattern.test(userAgent) || pattern.test(url) || pattern.test(body) || 
      Object.values(query).some(value => pattern.test(value))
    );

    if (suspiciousFound) {
      logger.warn('Suspicious request detected', {
        requestId: (request as any).requestId,
        method: request.method,
        url: request.url,
        ip: request.ip,
        userAgent,
        body: body.substring(0, 500), // Limit body length in logs
        query: Object.keys(query).length > 0 ? query : undefined,
        timestamp: new Date().toISOString(),
        severity: 'medium'
      });
    }
  };
};

// Business metrics middleware
export const businessMetricsLogger = (logger: Logger) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Implementation would go here
  };
};

// Error tracking middleware
export const errorTrackingLogger = (logger: Logger) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Implementation would go here
  };
};

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function trackRequestMetrics(request: FastifyRequest, reply: FastifyReply, duration: number): void {
  // In production, this would send metrics to Prometheus or similar
  // For now, we'll just log the metrics
  const metrics = {
    endpoint: request.url,
    method: request.method,
    statusCode: reply.statusCode,
    duration,
    timestamp: new Date().toISOString()
  };
  
  // This would be sent to a metrics collection system
  console.log('Request metrics:', metrics);
}

// Middleware for adding correlation ID
export function correlationIdMiddleware() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = request.headers['x-correlation-id'] as string || 
                         request.headers['x-request-id'] as string || 
                         generateRequestId();
    
    // Add correlation ID to request and response
    (request as any).correlationId = correlationId;
    reply.header('X-Correlation-ID', correlationId);
  };
}

// Middleware for request timing
export function requestTimingMiddleware() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = process.hrtime.bigint();
    // Implementation would go here
  };
}

// Middleware for security headers
export function securityHeadersMiddleware() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Add security headers
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Content-Security-Policy', "default-src 'self'");
  };
}

// Middleware for request validation logging
export function validationLoggingMiddleware(logger: Logger) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Log validation errors
    // Implementation would go here
  };
} 