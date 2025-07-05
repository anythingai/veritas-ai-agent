import Joi from 'joi';

// Request schema for verification endpoint
export const verifyRequestSchema = Joi.object({
  claim_text: Joi.string()
    .min(10)
    .max(10000)
    .required()
    .messages({
      'string.min': 'Claim text must be at least 10 characters long',
      'string.max': 'Claim text must not exceed 10,000 characters',
      'any.required': 'Claim text is required'
    }),
  
  source: Joi.string()
    .max(100)
    .optional()
    .default('browser-extension'),
  
  timestamp: Joi.string()
    .isoDate()
    .optional()
    .default(() => new Date().toISOString()),
  
  extension_version: Joi.string()
    .max(50)
    .optional()
});

// Response schema for verification endpoint
export const verificationResponseSchema = Joi.object({
  request_id: Joi.string()
    .uuid()
    .required(),
  
  status: Joi.string()
    .valid('VERIFIED', 'UNVERIFIED', 'UNKNOWN', 'ERROR')
    .required(),
  
  confidence: Joi.number()
    .min(0)
    .max(1)
    .optional()
    .allow(null),
  
  citations: Joi.array().items(
    Joi.object({
      doc_id: Joi.string().uuid().required(),
      cid: Joi.string().required(),
      title: Joi.string().required(),
      snippet: Joi.string().required(),
      similarity: Joi.number().min(0).max(1).required()
    })
  ).required(),
  
  cached: Joi.boolean()
    .optional()
    .default(false),
  
  processing_time_ms: Joi.number()
    .integer()
    .min(0)
    .required(),
  
  error: Joi.string()
    .optional()
    .only()
});

// Request schema for document upload
export const documentUploadSchema = Joi.object({
  title: Joi.string()
    .min(1)
    .max(500)
    .required(),
  
  content: Joi.string()
    .min(1)
    .max(10000000) // 10MB max
    .required(),
  
  mime_type: Joi.string()
    .valid(
      'text/plain',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/markdown'
    )
    .required(),
  
  source_url: Joi.string()
    .uri()
    .optional()
});

// Response schema for document upload
export const documentUploadResponseSchema = Joi.object({
  document_id: Joi.string()
    .uuid()
    .required(),
  
  status: Joi.string()
    .valid('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')
    .required(),
  
  message: Joi.string()
    .required(),
  
  cid: Joi.string()
    .optional()
    .allow(null)
});

// Request schema for analytics endpoint
export const analyticsRequestSchema = Joi.object({
  start_date: Joi.string()
    .isoDate()
    .optional(),
  
  end_date: Joi.string()
    .isoDate()
    .optional(),
  
  source: Joi.string()
    .max(100)
    .optional()
});

// Response schema for analytics endpoint
export const analyticsResponseSchema = Joi.object({
  total_requests: Joi.number()
    .integer()
    .min(0)
    .required(),
  
  verified_count: Joi.number()
    .integer()
    .min(0)
    .required(),
  
  unverified_count: Joi.number()
    .integer()
    .min(0)
    .required(),
  
  unknown_count: Joi.number()
    .integer()
    .min(0)
    .required(),
  
  average_confidence: Joi.number()
    .min(0)
    .max(1)
    .required(),
  
  average_processing_time: Joi.number()
    .min(0)
    .required(),
  
  requests_by_source: Joi.object()
    .pattern(Joi.string(), Joi.number().integer().min(0))
    .required(),
  
  requests_by_date: Joi.array().items(
    Joi.object({
      date: Joi.string().isoDate().required(),
      count: Joi.number().integer().min(0).required()
    })
  ).required()
});

// Health check response schema
export const healthCheckResponseSchema = Joi.object({
  status: Joi.string()
    .valid('healthy', 'degraded', 'unhealthy')
    .required(),
  
  timestamp: Joi.string()
    .isoDate()
    .required(),
  
  version: Joi.string()
    .required(),
  
  services: Joi.object({
    database: Joi.string().valid('healthy', 'unhealthy').required(),
    embedding: Joi.string().valid('healthy', 'unhealthy').required(),
    ipfs: Joi.string().valid('healthy', 'unhealthy').required()
  }).required(),
  
  error: Joi.string()
    .optional()
    .only()
});

// Error response schema
export const errorResponseSchema = Joi.object({
  error: Joi.string()
    .required(),
  
  message: Joi.string()
    .required(),
  
  code: Joi.string()
    .optional(),
  
  details: Joi.object()
    .optional(),
  
  timestamp: Joi.string()
    .isoDate()
    .optional()
    .default(() => new Date().toISOString())
});

// Rate limit error response schema
export const rateLimitErrorSchema = Joi.object({
  error: Joi.string()
    .valid('Too Many Requests')
    .required(),
  
  message: Joi.string()
    .required(),
  
  retryAfter: Joi.number()
    .integer()
    .min(0)
    .required()
});

// Validation error response schema
export const validationErrorSchema = Joi.object({
  error: Joi.string()
    .valid('Validation Error')
    .required(),
  
  message: Joi.string()
    .required(),
  
  details: Joi.array().items(
    Joi.object({
      field: Joi.string().required(),
      message: Joi.string().required(),
      value: Joi.any().optional()
    })
  ).required()
});

// Export all schemas
export const schemas = {
  verifyRequest: verifyRequestSchema,
  verifyResponse: verificationResponseSchema,
  documentUpload: documentUploadSchema,
  documentUploadResponse: documentUploadResponseSchema,
  analyticsRequest: analyticsRequestSchema,
  analyticsResponse: analyticsResponseSchema,
  healthCheck: healthCheckResponseSchema,
  error: errorResponseSchema,
  rateLimitError: rateLimitErrorSchema,
  validationError: validationErrorSchema
}; 