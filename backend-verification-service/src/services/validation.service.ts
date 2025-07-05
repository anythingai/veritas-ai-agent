import Joi from 'joi';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class ValidationService {
  private claimSchema = Joi.string()
    .min(10)
    .max(10000)
    .required()
    .messages({
      'string.min': 'Claim text must be at least 10 characters long',
      'string.max': 'Claim text must not exceed 10,000 characters',
      'any.required': 'Claim text is required'
    });

  private documentSchema = Joi.object({
    title: Joi.string().min(1).max(500).required(),
    content: Joi.string().min(1).max(10000000).required(), // 10MB max
    mime_type: Joi.string().valid('text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/markdown').required(),
    source_url: Joi.string().uri().optional()
  });

  private apiKeySchema = Joi.string()
    .pattern(/^[a-zA-Z0-9\-_]{32,64}$/)
    .required();

  validateClaim(claimText: string): boolean {
    const result = this.claimSchema.validate(claimText);
    return !result.error;
  }

  validateDocument(document: any): boolean {
    const result = this.documentSchema.validate(document);
    return !result.error;
  }

  validateApiKey(apiKey: string): boolean {
    const result = this.apiKeySchema.validate(apiKey);
    return !result.error;
  }

  sanitizeInput(input: string): string {
    if (!input || typeof input !== 'string') {
      return '';
    }

    // Remove potentially dangerous characters
    return input
      .replace(/[<>]/g, '') // Remove < and >
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+=/gi, '') // Remove event handlers
      .trim();
  }

  validateEmail(email: string): boolean {
    const emailSchema = Joi.string().email().required();
    const result = emailSchema.validate(email);
    return !result.error;
  }

  validateURL(url: string): boolean {
    const urlSchema = Joi.string().uri().required();
    const result = urlSchema.validate(url);
    return !result.error;
  }

  validateVerificationRequest(request: any): ValidationResult {
    const schema = Joi.object({
      claim_text: this.claimSchema,
      source: Joi.string().max(100).optional(),
      timestamp: Joi.string().isoDate().optional(),
      extension_version: Joi.string().max(50).optional()
    });

    const result = schema.validate(request);
    
    if (result.error) {
      return {
        isValid: false,
        errors: result.error.details.map(detail => detail.message)
      };
    }

    return { isValid: true, errors: [] };
  }

  validateDocumentUpload(file: any): ValidationResult {
    const maxSize = parseInt(process.env.MAX_FILE_SIZE || '52428800'); // 50MB default
    const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'pdf,docx,txt,md').split(',');

    const errors: string[] = [];

    // Check file size
    if (file.size > maxSize) {
      errors.push(`File size exceeds maximum allowed size of ${maxSize / 1024 / 1024}MB`);
    }

    // Check file type
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    if (!fileExtension || !allowedTypes.includes(fileExtension)) {
      errors.push(`File type not allowed. Allowed types: ${allowedTypes.join(', ')}`);
    }

    // Check file name
    if (!file.name || file.name.length > 255) {
      errors.push('Invalid file name');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  generateValidationError(message: string): ValidationResult {
    return {
      isValid: false,
      errors: [message]
    };
  }
} 