import { FastifyRequest, FastifyReply } from 'fastify';
import { Logger } from 'winston';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
  context?: any;
}

export function errorHandler(logger: Logger) {
  return function (
    error: AppError,
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    // Determine if this is an operational error
    const isOperational = error.isOperational || false;
    
    // Set default status code
    const statusCode = error.statusCode || 500;
    
    // Log the error
    logger.error('Request error', {
      error: error.message,
      stack: error.stack,
      statusCode,
      method: request.method,
      url: request.url,
      ip: request.ip || request.headers['x-forwarded-for'],
      userAgent: request.headers['user-agent'],
      isOperational,
      context: error.context
    });

    // Prepare error response
    const errorResponse: any = {
      error: getErrorTitle(statusCode),
      message: getErrorMessage(error, statusCode),
      timestamp: new Date().toISOString()
    };

    // Add error code if available
    if (error.code) {
      errorResponse.code = error.code;
    }

    // Add additional context in development
    if (process.env.NODE_ENV !== 'production' && error.context) {
      errorResponse.details = error.context;
    }

    // Add stack trace in development
    if (process.env.NODE_ENV !== 'production' && error.stack) {
      errorResponse.stack = error.stack;
    }

    // Set response status and send
    reply.status(statusCode).send(errorResponse);
  };
}

function getErrorTitle(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 409:
      return 'Conflict';
    case 422:
      return 'Unprocessable Entity';
    case 429:
      return 'Too Many Requests';
    case 500:
      return 'Internal Server Error';
    case 502:
      return 'Bad Gateway';
    case 503:
      return 'Service Unavailable';
    case 504:
      return 'Gateway Timeout';
    default:
      return 'Error';
  }
}

function getErrorMessage(error: AppError, statusCode: number): string {
  // If error has a specific message, use it
  if (error.message && error.message !== 'Error') {
    return error.message;
  }

  // Return generic messages based on status code
  switch (statusCode) {
    case 400:
      return 'The request could not be understood or was missing required parameters';
    case 401:
      return 'Authentication is required and has failed or has not been provided';
    case 403:
      return 'The server understood the request but refuses to authorize it';
    case 404:
      return 'The requested resource was not found';
    case 409:
      return 'The request could not be completed due to a conflict with the current state';
    case 422:
      return 'The request was well-formed but was unable to be followed due to semantic errors';
    case 429:
      return 'Too many requests have been sent in a given amount of time';
    case 500:
      return 'An internal server error occurred';
    case 502:
      return 'The server received an invalid response from an upstream server';
    case 503:
      return 'The service is temporarily unavailable';
    case 504:
      return 'The server did not receive a timely response from an upstream server';
    default:
      return 'An unexpected error occurred';
  }
}

// Custom error classes
export class ValidationError extends Error implements AppError {
  statusCode = 400;
  code = 'VALIDATION_ERROR';
  isOperational = true;

  constructor(message: string, public context?: any) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends Error implements AppError {
  statusCode = 401;
  code = 'AUTHENTICATION_ERROR';
  isOperational = true;

  constructor(message: string = 'Authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error implements AppError {
  statusCode = 403;
  code = 'AUTHORIZATION_ERROR';
  isOperational = true;

  constructor(message: string = 'Access denied') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends Error implements AppError {
  statusCode = 404;
  code = 'NOT_FOUND';
  isOperational = true;

  constructor(resource: string = 'Resource') {
    super(`${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends Error implements AppError {
  statusCode = 429;
  code = 'RATE_LIMIT_EXCEEDED';
  isOperational = true;

  constructor(message: string = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ExternalServiceError extends Error implements AppError {
  statusCode = 502;
  code = 'EXTERNAL_SERVICE_ERROR';
  isOperational = true;
  context: any;

  constructor(service: string, message?: string) {
    super(message || `External service '${service}' is unavailable`);
    this.name = 'ExternalServiceError';
    this.context = { service };
  }
}

export class DatabaseError extends Error implements AppError {
  statusCode = 500;
  code = 'DATABASE_ERROR';
  isOperational = false;

  constructor(message: string, public context?: any) {
    super(message);
    this.name = 'DatabaseError';
  }
}

// Error factory functions
export function createValidationError(message: string, context?: any): ValidationError {
  return new ValidationError(message, context);
}

export function createAuthenticationError(message?: string): AuthenticationError {
  return new AuthenticationError(message);
}

export function createAuthorizationError(message?: string): AuthorizationError {
  return new AuthorizationError(message);
}

export function createNotFoundError(resource?: string): NotFoundError {
  return new NotFoundError(resource);
}

export function createRateLimitError(message?: string): RateLimitError {
  return new RateLimitError(message);
}

export function createExternalServiceError(service: string, message?: string): ExternalServiceError {
  return new ExternalServiceError(service, message);
}

export function createDatabaseError(message: string, context?: any): DatabaseError {
  return new DatabaseError(message, context);
}

// Async error wrapper
export function asyncErrorHandler(fn: Function) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await fn(request, reply);
    } catch (error) {
      // Let the error handler middleware deal with it
      throw error;
    }
  };
} 