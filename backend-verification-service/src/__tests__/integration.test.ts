import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { build } from '../index';
import { DatabaseService } from '../services/database.service';
import { EmbeddingService } from '../services/embedding.service';
import { IPFSService } from '../services/ipfs.service';
import { MetricsService } from '../services/metrics.service';
import { ValidationService } from '../services/validation.service';
import { CacheService } from '../services/cache.service';

// Mock external dependencies
vi.mock('../services/database.service');
vi.mock('../services/embedding.service');
vi.mock('../services/ipfs.service');
vi.mock('../services/metrics.service');
vi.mock('../services/validation.service');
vi.mock('../services/cache.service');

describe('Veritas Verification Service - Integration Tests', () => {
  let app: FastifyInstance;
  let mockDatabaseService: any;
  let mockEmbeddingService: any;
  let mockIPFSService: any;
  let mockMetricsService: any;
  let mockValidationService: any;
  let mockCacheService: any;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock services
    mockDatabaseService = {
      healthCheck: vi.fn().mockResolvedValue(true),
      searchSimilarDocuments: vi.fn(),
      storeDocument: vi.fn(),
      storeVerificationRequest: vi.fn(),
      getDocuments: vi.fn(),
      getVerificationAnalytics: vi.fn(),
      initialize: vi.fn().mockResolvedValue(undefined),
      getConnectionCount: vi.fn().mockReturnValue(5),
      executeQuery: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn()
    };

    mockEmbeddingService = {
      embedText: vi.fn(),
      rerankDocuments: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(true),
      initialize: vi.fn().mockResolvedValue(undefined),
      validateEmbedding: vi.fn().mockReturnValue(true),
      getEmbeddingDimensions: vi.fn().mockReturnValue(1536)
    };

    mockIPFSService = {
      storeDocument: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(true),
      initialize: vi.fn().mockResolvedValue(undefined),
      retrieveDocument: vi.fn(),
      validateCID: vi.fn().mockReturnValue(true),
      getGatewayURL: vi.fn().mockReturnValue('https://ipfs.io/ipfs/')
    };

    mockMetricsService = {
      recordVerificationRequest: vi.fn(),
      recordVerificationMetrics: vi.fn(),
      recordCacheHit: vi.fn(),
      recordCacheMiss: vi.fn(),
      recordError: vi.fn(),
      recordExternalServiceError: vi.fn(),
      recordDatabaseError: vi.fn(),
      recordValidationError: vi.fn(),
      recordSecurityEvent: vi.fn(),
      recordRateLimitExceeded: vi.fn(),
      recordAuthenticationFailure: vi.fn(),
      recordSlowQuery: vi.fn(),
      recordExternalServiceLatency: vi.fn(),
      recordDatabaseLatency: vi.fn(),
      setCacheSize: vi.fn(),
      updateSystemMetrics: vi.fn(),
      setUniqueUsers: vi.fn(),
      recordApiUsage: vi.fn(),
      recordApiUsageByUser: vi.fn(),
      calculateBusinessMetrics: vi.fn().mockResolvedValue({
        uniqueUsers: 1000,
        dailyVerifications: 50000,
        averageResponseTime: 0.3,
        errorRate: 0.01,
        cacheHitRate: 0.85
      })
    };

    mockValidationService = {
      validateClaim: vi.fn().mockReturnValue(true),
      validateDocument: vi.fn().mockReturnValue(true),
      validateApiKey: vi.fn().mockReturnValue(true),
      sanitizeInput: vi.fn().mockImplementation((input: string) => input),
      validateEmail: vi.fn().mockReturnValue(true),
      validateURL: vi.fn().mockReturnValue(true),
      validateVerificationRequest: vi.fn().mockReturnValue({ isValid: true, errors: [] }),
      validateDocumentUpload: vi.fn().mockReturnValue({ isValid: true, errors: [] }),
      generateValidationError: vi.fn().mockReturnValue({ isValid: false, errors: ['Validation error'] })
    };

    mockCacheService = {
      get: vi.fn(),
      set: vi.fn(),
      initialize: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
      clear: vi.fn(),
      getSize: vi.fn().mockReturnValue(1000),
      getStats: vi.fn().mockReturnValue({
        hits: 500,
        misses: 100,
        hitRate: 0.83
      })
    };

    // Mock the service constructors
    vi.mocked(DatabaseService).mockImplementation(() => mockDatabaseService);
    vi.mocked(EmbeddingService).mockImplementation(() => mockEmbeddingService);
    vi.mocked(IPFSService).mockImplementation(() => mockIPFSService);
    vi.mocked(MetricsService).mockImplementation(() => mockMetricsService);
    vi.mocked(ValidationService).mockImplementation(() => mockValidationService);
    vi.mocked(CacheService).mockImplementation(() => mockCacheService);

    // Build the app
    app = await build();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('End-to-End Verification Flow', () => {
    it('should complete full verification flow successfully', async () => {
      const claimText = 'The Earth orbits around the Sun';
      const mockEmbedding = new Array(1536).fill(0.1);
      const mockDocuments = [
        {
          id: 'doc-1',
          cid: 'QmTest123',
          title: 'Science Textbook',
          content: 'The Earth orbits around the Sun in an elliptical path.',
          similarity: 0.85
        }
      ];

      // Setup mocks for successful flow
      mockCacheService.get.mockResolvedValue(null); // Cache miss
      mockEmbeddingService.embedText.mockResolvedValue(mockEmbedding);
      mockDatabaseService.searchSimilarDocuments.mockResolvedValue(mockDocuments);
      mockEmbeddingService.rerankDocuments.mockResolvedValue(mockDocuments);
      mockCacheService.set.mockResolvedValue(undefined);
      mockDatabaseService.storeVerificationRequest.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': 'Bearer veritas-1234567890abcdef1234567890abcdef',
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: claimText,
          source: 'chatgpt',
          timestamp: new Date().toISOString(),
          extension_version: '1.1.0'
        }
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      
      expect(result.status).toBe('VERIFIED');
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.citations).toHaveLength(1);
      expect(result.cached).toBe(false);
      expect(result.processing_time_ms).toBeGreaterThan(0);

      // Verify all services were called
      expect(mockCacheService.get).toHaveBeenCalled();
      expect(mockEmbeddingService.embedText).toHaveBeenCalledWith(claimText);
      expect(mockDatabaseService.searchSimilarDocuments).toHaveBeenCalled();
      expect(mockEmbeddingService.rerankDocuments).toHaveBeenCalled();
      expect(mockCacheService.set).toHaveBeenCalled();
      expect(mockDatabaseService.storeVerificationRequest).toHaveBeenCalled();
      expect(mockMetricsService.recordVerificationRequest).toHaveBeenCalled();
    });

    it('should return cached result when available', async () => {
      const claimText = 'The Earth orbits around the Sun';
      const cachedResult = {
        status: 'VERIFIED',
        confidence: 0.9,
        citations: [
          {
            doc_id: 'doc-1',
            cid: 'QmTest123',
            title: 'Science Textbook',
            snippet: 'The Earth orbits around the Sun.',
            similarity: 0.85
          }
        ]
      };

      mockCacheService.get.mockResolvedValue(cachedResult);

      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': 'Bearer veritas-1234567890abcdef1234567890abcdef',
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: claimText,
          source: 'chatgpt'
        }
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      
      expect(result.cached).toBe(true);
      expect(result.status).toBe('VERIFIED');
      expect(result.confidence).toBe(0.9);

      // Verify cache was checked but no processing occurred
      expect(mockCacheService.get).toHaveBeenCalled();
      expect(mockEmbeddingService.embedText).not.toHaveBeenCalled();
      expect(mockDatabaseService.searchSimilarDocuments).not.toHaveBeenCalled();
    });

    it('should handle no similar documents found', async () => {
      const claimText = 'This is a completely false claim that no documents support';
      
      mockCacheService.get.mockResolvedValue(null);
      mockEmbeddingService.embedText.mockResolvedValue(new Array(1536).fill(0.1));
      mockDatabaseService.searchSimilarDocuments.mockResolvedValue([]);

      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': 'Bearer veritas-1234567890abcdef1234567890abcdef',
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: claimText,
          source: 'chatgpt'
        }
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      
      expect(result.status).toBe('UNKNOWN');
      expect(result.confidence).toBe(0.0);
      expect(result.citations).toHaveLength(0);
    });

    it('should handle embedding service failure gracefully', async () => {
      const claimText = 'The Earth orbits around the Sun';
      
      mockCacheService.get.mockResolvedValue(null);
      mockEmbeddingService.embedText.mockRejectedValue(new Error('Embedding service unavailable'));

      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': 'Bearer veritas-1234567890abcdef1234567890abcdef',
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: claimText,
          source: 'chatgpt'
        }
      });

      expect(response.statusCode).toBe(500);
      const result = JSON.parse(response.payload);
      
      expect(result.status).toBe('ERROR');
      expect(result.error).toBe('Internal server error');
    });
  });

  describe('Authentication and Authorization', () => {
    it('should reject requests without API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: 'Test claim'
        }
      });

      expect(response.statusCode).toBe(401);
      const result = JSON.parse(response.payload);
      expect(result.error).toBe('Unauthorized');
      expect(result.code).toBe('MISSING_API_KEY');
    });

    it('should reject invalid API key format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': 'Bearer invalid-key',
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: 'Test claim'
        }
      });

      expect(response.statusCode).toBe(401);
      const result = JSON.parse(response.payload);
      expect(result.error).toBe('Unauthorized');
      expect(result.code).toBe('INVALID_API_KEY_FORMAT');
    });

    it('should reject unknown API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': 'Bearer unknown-1234567890abcdef1234567890abcdef',
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: 'Test claim'
        }
      });

      expect(response.statusCode).toBe(401);
      const result = JSON.parse(response.payload);
      expect(result.error).toBe('Unauthorized');
      expect(result.code).toBe('INVALID_API_KEY');
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const claimText = 'Test claim for rate limiting';
      
      // Mock successful verification
      mockCacheService.get.mockResolvedValue(null);
      mockEmbeddingService.embedText.mockResolvedValue(new Array(1536).fill(0.1));
      mockDatabaseService.searchSimilarDocuments.mockResolvedValue([]);

      // Make multiple requests rapidly
      const promises = Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST',
          url: '/verify',
          headers: {
            'Authorization': 'Bearer viewer-1234567890abcdef1234567890abcdef',
            'Content-Type': 'application/json'
          },
          payload: {
            claim_text: claimText,
            source: 'test'
          }
        })
      );

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited
      const rateLimited = responses.filter(r => r.statusCode === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
      
      const successful = responses.filter(r => r.statusCode === 200);
      expect(successful.length).toBeGreaterThan(0);
    });
  });

  describe('Document Management', () => {
    it('should add document successfully', async () => {
      const document = {
        title: 'Test Document',
        content: 'This is test content for verification.',
        mime_type: 'text/plain',
        source_url: 'https://example.com/test'
      };

      mockIPFSService.storeDocument.mockResolvedValue('QmTestCID123');
      mockEmbeddingService.embedText.mockResolvedValue(new Array(1536).fill(0.1));
      mockDatabaseService.storeDocument.mockResolvedValue('doc-123');

      const response = await app.inject({
        method: 'POST',
        url: '/documents',
        headers: {
          'Authorization': 'Bearer veritas-1234567890abcdef1234567890abcdef',
          'Content-Type': 'application/json'
        },
        payload: document
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.document_id).toBe('doc-123');

      expect(mockIPFSService.storeDocument).toHaveBeenCalledWith(document.content);
      expect(mockDatabaseService.storeDocument).toHaveBeenCalled();
    });

    it('should retrieve documents with pagination', async () => {
      const mockDocuments = [
        {
          id: 'doc-1',
          title: 'Document 1',
          cid: 'QmTest1',
          mime_type: 'text/plain',
          created_at: new Date().toISOString()
        },
        {
          id: 'doc-2',
          title: 'Document 2',
          cid: 'QmTest2',
          mime_type: 'text/plain',
          created_at: new Date().toISOString()
        }
      ];

      mockDatabaseService.getDocuments.mockResolvedValue({
        documents: mockDocuments,
        total: 2,
        page: 1,
        limit: 20
      });

      const response = await app.inject({
        method: 'GET',
        url: '/documents?page=1&limit=20',
        headers: {
          'Authorization': 'Bearer veritas-1234567890abcdef1234567890abcdef'
        }
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.documents).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe('Analytics', () => {
    it('should retrieve verification analytics', async () => {
      const mockAnalytics = {
        total_verifications: 1000,
        verified_count: 800,
        unverified_count: 150,
        unknown_count: 50,
        average_confidence: 0.75,
        average_response_time: 250,
        daily_breakdown: [
          { date: '2024-01-01', count: 100 },
          { date: '2024-01-02', count: 120 }
        ]
      };

      mockDatabaseService.getVerificationAnalytics.mockResolvedValue(mockAnalytics);

      const response = await app.inject({
        method: 'GET',
        url: '/analytics/verifications?start_date=2024-01-01&end_date=2024-01-02',
        headers: {
          'Authorization': 'Bearer veritas-1234567890abcdef1234567890abcdef'
        }
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.total_verifications).toBe(1000);
      expect(result.verified_count).toBe(800);
    });
  });

  describe('Error Handling', () => {
    it('should handle validation errors gracefully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': 'Bearer veritas-1234567890abcdef1234567890abcdef',
          'Content-Type': 'application/json'
        },
        payload: {
          // Missing required claim_text field
          source: 'test'
        }
      });

      expect(response.statusCode).toBe(400);
      const result = JSON.parse(response.payload);
      expect(result.error).toBe('Bad Request');
    });

    it('should handle database connection errors', async () => {
      mockDatabaseService.healthCheck.mockRejectedValue(new Error('Database connection failed'));

      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(503);
      const result = JSON.parse(response.payload);
      expect(result.status).toBe('unhealthy');
    });

    it('should handle external service failures', async () => {
      mockIPFSService.healthCheck.mockRejectedValue(new Error('IPFS service unavailable'));

      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.status).toBe('degraded');
      expect(result.services.ipfs).toBe('unhealthy');
    });
  });

  describe('Performance and Monitoring', () => {
    it('should record metrics for successful verifications', async () => {
      const claimText = 'Performance test claim';
      
      mockCacheService.get.mockResolvedValue(null);
      mockEmbeddingService.embedText.mockResolvedValue(new Array(1536).fill(0.1));
      mockDatabaseService.searchSimilarDocuments.mockResolvedValue([]);

      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': 'Bearer veritas-1234567890abcdef1234567890abcdef',
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: claimText,
          source: 'performance-test'
        }
      });

      expect(response.statusCode).toBe(200);
      
      expect(mockMetricsService.recordVerificationRequest).toHaveBeenCalled();
      expect(mockMetricsService.recordVerificationMetrics).toHaveBeenCalled();
    });

    it('should expose metrics endpoint', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/metrics'
      });

      expect(response.statusCode).toBe(200);
      expect(response.payload).toContain('veritas_verification_requests_total');
    });
  });
}); 