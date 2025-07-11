import { FastifyRequest, FastifyReply, FastifyError } from 'fastify';
import { Logger } from 'winston';

interface ErrorResponse {
  error: string;
  message: string;
  code?: string;
  details?: any;
  timestamp: string;
  requestId?: string;
  statusCode: number;
}

interface ValidationErrorDetails {
  field: string;
  message: string;
  value?: any;
  code?: string;
}

export function errorHandler(logger: Logger) {
  return async (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request as any).id || generateRequestId();
    const timestamp = new Date().toISOString();
    
    // Log the error with context
    logger.error('Request error', {
      requestId,
      error: error.message,
      stack: error.stack,
      statusCode: error.statusCode,
      method: request.method,
      url: request.url,
      userAgent: request.headers['user-agent'],
      ip: request.ip,
      timestamp
    });

    // Determine error type and create appropriate response
    const errorResponse = createErrorResponse(error, requestId, timestamp);
    
    // Set security headers
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');

    // Send error response
    reply.status(errorResponse.statusCode).send(errorResponse);
  };
}

function createErrorResponse(error: FastifyError, requestId: string, timestamp: string): ErrorResponse {
  const baseResponse = {
    timestamp,
    requestId
  };

  // Handle validation errors (Joi, JSON schema, etc.)
  if (error.statusCode === 400 && error.validation) {
    return {
      ...baseResponse,
      statusCode: 400,
      error: 'Validation Error',
      message: 'Request validation failed',
      code: 'VALIDATION_ERROR',
      details: formatValidationErrors(error.validation)
    };
  }

  // Handle authentication errors
  if (error.statusCode === 401) {
    return {
      ...baseResponse,
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Authentication required or invalid credentials',
      code: 'AUTHENTICATION_ERROR'
    };
  }

  // Handle authorization errors
  if (error.statusCode === 403) {
    return {
      ...baseResponse,
      statusCode: 403,
      error: 'Forbidden',
      message: 'Insufficient permissions to access this resource',
      code: 'AUTHORIZATION_ERROR'
    };
  }

  // Handle not found errors
  if (error.statusCode === 404) {
    return {
      ...baseResponse,
      statusCode: 404,
      error: 'Not Found',
      message: 'The requested resource was not found',
      code: 'RESOURCE_NOT_FOUND'
    };
  }

  // Handle rate limiting errors
  if (error.statusCode === 429) {
    return {
      ...baseResponse,
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      details: {
        retryAfter: (error as any).headers?.['retry-after'] || 60
      }
    };
  }

  // Handle timeout errors
  if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
    return {
      ...baseResponse,
      statusCode: 504,
      error: 'Gateway Timeout',
      message: 'The request timed out. Please try again.',
      code: 'REQUEST_TIMEOUT'
    };
  }

  // Handle database connection errors
  if (error.message.includes('database') || error.code === 'ECONNREFUSED') {
    return {
      ...baseResponse,
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Database connection error. Please try again later.',
      code: 'DATABASE_ERROR'
    };
  }

  // Handle Redis/cache errors
  if (error.message.includes('Redis') || error.message.includes('cache')) {
    return {
      ...baseResponse,
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Cache service temporarily unavailable',
      code: 'CACHE_ERROR'
    };
  }

  // Handle IPFS errors
  if (error.message.includes('IPFS') || error.message.includes('ipfs')) {
    return {
      ...baseResponse,
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Document storage service temporarily unavailable',
      code: 'IPFS_ERROR'
    };
  }

  // Handle OpenAI API errors
  if (error.message.includes('OpenAI') || error.message.includes('embedding')) {
    return {
      ...baseResponse,
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'AI service temporarily unavailable',
      code: 'AI_SERVICE_ERROR'
    };
  }

  // Handle JSON parsing errors
  if (error.message.includes('JSON') || error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return {
      ...baseResponse,
      statusCode: 400,
      error: 'Bad Request',
      message: 'Invalid JSON format in request body',
      code: 'JSON_PARSE_ERROR'
    };
  }

  // Handle file size errors
  if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return {
      ...baseResponse,
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'Request body exceeds maximum allowed size',
      code: 'PAYLOAD_TOO_LARGE'
    };
  }

  // Handle internal server errors
  if ((error.statusCode && error.statusCode >= 500) || !error.statusCode) {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    return {
      ...baseResponse,
      statusCode: 500,
      error: 'Internal Server Error',
      message: isDevelopment 
        ? error.message 
        : 'An unexpected error occurred. Please try again later.',
      code: 'INTERNAL_ERROR',
      ...(isDevelopment && { details: { stack: error.stack } })
    };
  }

  // Handle client errors (4xx)
  if (error.statusCode >= 400 && error.statusCode < 500) {
    return {
      ...baseResponse,
      statusCode: error.statusCode,
      error: 'Client Error',
      message: error.message || 'Invalid request',
      code: 'CLIENT_ERROR'
    };
  }

  // Default error response
  return {
    ...baseResponse,
    statusCode: error.statusCode || 500,
    error: 'Unknown Error',
    message: 'An unexpected error occurred',
    code: 'UNKNOWN_ERROR'
  };
}

function formatValidationErrors(validation: any[]): ValidationErrorDetails[] {
  return validation.map(err => ({
    field: err.instancePath || err.dataPath || 'unknown',
    message: err.message || 'Validation failed',
    value: err.data,
    code: err.keyword || err.code
  }));
}

function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

// Custom error classes for different error types
export class VeritasError extends Error {
  public statusCode: number;
  public code: string;
  public details?: any;

  constructor(message: string, statusCode: number = 500, code: string = 'VERITAS_ERROR', details?: any) {
    super(message);
    this.name = 'VeritasError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends VeritasError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends VeritasError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends VeritasError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends VeritasError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND_ERROR');
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends VeritasError {
  constructor(message: string = 'Rate limit exceeded', retryAfter: number = 60) {
    super(message, 429, 'RATE_LIMIT_ERROR', { retryAfter });
    this.name = 'RateLimitError';
  }
}

export class ServiceUnavailableError extends VeritasError {
  constructor(message: string = 'Service temporarily unavailable', service?: string) {
    super(message, 503, 'SERVICE_UNAVAILABLE', { service });
    this.name = 'ServiceUnavailableError';
  }
}

export class DatabaseError extends ServiceUnavailableError {
  constructor(message: string = 'Database connection error') {
    super(message, 'database');
    this.name = 'DatabaseError';
    this.code = 'DATABASE_ERROR';
  }
}

export class CacheError extends ServiceUnavailableError {
  constructor(message: string = 'Cache service error') {
    super(message, 'cache');
    this.name = 'CacheError';
    this.code = 'CACHE_ERROR';
  }
}

export class IPFSError extends ServiceUnavailableError {
  constructor(message: string = 'IPFS service error') {
    super(message, 'ipfs');
    this.name = 'IPFSError';
    this.code = 'IPFS_ERROR';
  }
}

export class AIServiceError extends ServiceUnavailableError {
  constructor(message: string = 'AI service error') {
    super(message, 'ai');
    this.name = 'AIServiceError';
    this.code = 'AI_SERVICE_ERROR';
  }
}

// Circuit breaker for external services
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private failureThreshold: number = 5,
    private timeout: number = 60000, // 1 minute
    private retryTimeout: number = 30000, // 30 seconds
    private logger?: Logger
  ) {}

  async execute<T>(operation: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.retryTimeout) {
        this.state = 'HALF_OPEN';
        this.logger?.info('Circuit breaker transitioning to HALF_OPEN');
      } else {
        this.logger?.warn('Circuit breaker is OPEN, using fallback');
        if (fallback) {
          return await fallback();
        }
        throw new ServiceUnavailableError('Service circuit breaker is open');
      }
    }

    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), this.timeout)
        )
      ]);

      if (this.state === 'HALF_OPEN') {
        this.reset();
        this.logger?.info('Circuit breaker reset to CLOSED');
      }

      return result;
    } catch (error) {
      this.recordFailure();
      
      if (fallback) {
        this.logger?.warn('Circuit breaker operation failed, using fallback');
        return await fallback();
      }
      
      throw error;
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.logger?.error(`Circuit breaker opened after ${this.failures} failures`);
    }
  }

  private reset(): void {
    this.failures = 0;
    this.state = 'CLOSED';
    this.lastFailureTime = 0;
  }

  getState(): { state: string; failures: number; lastFailureTime: number } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime
    };
  }
}

// Graceful degradation utility
export class GracefulDegradation {
  constructor(private logger: Logger) {}

  async withFallback<T>(
    primary: () => Promise<T>,
    fallback: () => Promise<T>,
    fallbackCondition?: (error: any) => boolean
  ): Promise<T> {
    try {
      return await primary();
    } catch (error) {
      const shouldUseFallback = fallbackCondition ? fallbackCondition(error) : true;
      
      if (shouldUseFallback) {
        this.logger.warn('Primary operation failed, using fallback', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        return await fallback();
      }
      
      throw error;
    }
  }

  async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000,
    backoffMultiplier: number = 2
  ): Promise<T> {
    let lastError: any;
    let currentDelay = delay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries) {
          break;
        }

        this.logger.warn(`Operation failed, retrying in ${currentDelay}ms`, {
          attempt: attempt + 1,
          maxRetries,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        await new Promise(resolve => setTimeout(resolve, currentDelay));
        currentDelay *= backoffMultiplier;
      }
    }

    throw lastError;
  }
} 