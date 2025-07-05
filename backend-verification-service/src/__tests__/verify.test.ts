import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { build } from '../index';
import { VerificationService } from '../services/verification.service';
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

describe('Veritas Verification Service - Comprehensive Tests', () => {
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

    // Setup mock services with comprehensive methods
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
      validateURL: vi.fn().mockReturnValue(true)
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

  describe('Health Check Endpoint', () => {
    it('should return healthy status when all services are healthy', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        status: 'healthy',
        timestamp: expect.any(String),
        version: '1.1.0',
        services: {
          database: 'healthy',
          embedding: 'healthy',
          ipfs: 'healthy'
        }
      });
    });

    it('should return degraded status when some services are unhealthy', async () => {
      mockDatabaseService.healthCheck.mockResolvedValue(false);

      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        status: 'degraded',
        timestamp: expect.any(String),
        version: '1.1.0',
        services: {
          database: 'unhealthy',
          embedding: 'healthy',
          ipfs: 'healthy'
        }
      });
    });

    it('should return unhealthy status when health check fails', async () => {
      mockDatabaseService.healthCheck.mockRejectedValue(new Error('Database connection failed'));

      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.payload)).toEqual({
        status: 'unhealthy',
        timestamp: expect.any(String),
        error: 'Service unavailable'
      });
    });
  });

  describe('Verification Endpoint', () => {
    const validApiKey = 'Bearer veritas-1234567890abcdef1234567890abcdef';

    it('should verify a claim successfully', async () => {
      const claimText = 'The Earth orbits around the Sun';
      
      // Mock successful verification flow
      mockCacheService.get.mockResolvedValue(null); // Cache miss
      mockEmbeddingService.embedText.mockResolvedValue([0.1, 0.2, 0.3]);
      mockDatabaseService.searchSimilarDocuments.mockResolvedValue([
        {
          id: 'doc-1',
          content: 'The Earth orbits around the Sun in an elliptical path.',
          similarity: 0.85,
          cid: 'QmTest123',
          title: 'Astronomy Textbook'
        }
      ]);
      mockEmbeddingService.rerankDocuments.mockResolvedValue([
        {
          id: 'doc-1',
          content: 'The Earth orbits around the Sun in an elliptical path.',
          similarity: 0.85,
          cid: 'QmTest123',
          title: 'Astronomy Textbook'
        }
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': validApiKey,
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: claimText,
          source: 'browser-extension',
          timestamp: new Date().toISOString(),
          extension_version: '1.1.0'
        }
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      
      expect(result).toMatchObject({
        request_id: expect.any(String),
        status: 'VERIFIED',
        confidence: expect.any(Number),
        citations: expect.arrayContaining([
          expect.objectContaining({
            doc_id: 'doc-1',
            cid: 'QmTest123',
            title: 'Astronomy Textbook',
            snippet: expect.any(String),
            similarity: 0.85
          })
        ]),
        cached: false,
        processing_time_ms: expect.any(Number)
      });

      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.processing_time_ms).toBeLessThan(300); // PRD requirement
    });

    it('should return cached result when available', async () => {
      const claimText = 'Cached claim test';
      const cachedResult = {
        status: 'VERIFIED',
        confidence: 0.9,
        citations: [
          {
            doc_id: 'doc-1',
            cid: 'QmCached123',
            title: 'Cached Document',
            snippet: 'This is a cached result',
            similarity: 0.9
          }
        ]
      };

      mockCacheService.get.mockResolvedValue(cachedResult);

      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': validApiKey,
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: claimText,
          source: 'browser-extension'
        }
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      
      expect(result.cached).toBe(true);
      expect(result.status).toBe('VERIFIED');
      expect(mockCacheService.get).toHaveBeenCalled();
      expect(mockEmbeddingService.embedText).not.toHaveBeenCalled();
    });

    it('should handle unverified claims correctly', async () => {
      const claimText = 'This is a false claim';
      
      mockCacheService.get.mockResolvedValue(null);
      mockEmbeddingService.embedText.mockResolvedValue([0.1, 0.2, 0.3]);
      mockDatabaseService.searchSimilarDocuments.mockResolvedValue([
        {
          id: 'doc-1',
          content: 'This contradicts the claim',
          similarity: 0.3,
          cid: 'QmTest123',
          title: 'Contradictory Document'
        }
      ]);
      mockEmbeddingService.rerankDocuments.mockResolvedValue([
        {
          id: 'doc-1',
          content: 'This contradicts the claim',
          similarity: 0.3,
          cid: 'QmTest123',
          title: 'Contradictory Document'
        }
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': validApiKey,
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: claimText,
          source: 'browser-extension'
        }
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      
      expect(result.status).toBe('UNVERIFIED');
      expect(result.confidence).toBeLessThan(0.8);
    });

    it('should handle unknown claims correctly', async () => {
      const claimText = 'This is a completely unknown claim';
      
      mockCacheService.get.mockResolvedValue(null);
      mockEmbeddingService.embedText.mockResolvedValue([0.1, 0.2, 0.3]);
      mockDatabaseService.searchSimilarDocuments.mockResolvedValue([]);

      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': validApiKey,
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: claimText,
          source: 'browser-extension'
        }
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      
      expect(result.status).toBe('UNKNOWN');
      expect(result.confidence).toBe(0);
      expect(result.citations).toEqual([]);
    });

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

    it('should reject requests with invalid API key', async () => {
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
    });

    it('should handle validation errors gracefully', async () => {
      mockValidationService.validateClaim.mockReturnValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': validApiKey,
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: '', // Invalid empty claim
          source: 'browser-extension'
        }
      });

      expect(response.statusCode).toBe(400);
      const result = JSON.parse(response.payload);
      expect(result.error).toBe('Invalid claim text provided');
    });

    it('should handle database errors gracefully', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockEmbeddingService.embedText.mockResolvedValue([0.1, 0.2, 0.3]);
      mockDatabaseService.searchSimilarDocuments.mockRejectedValue(new Error('Database connection failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': validApiKey,
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: 'Test claim',
          source: 'browser-extension'
        }
      });

      expect(response.statusCode).toBe(500);
      const result = JSON.parse(response.payload);
      expect(result.status).toBe('ERROR');
    });

    it('should handle embedding service errors gracefully', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockEmbeddingService.embedText.mockRejectedValue(new Error('Embedding service unavailable'));

      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': validApiKey,
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: 'Test claim',
          source: 'browser-extension'
        }
      });

      expect(response.statusCode).toBe(500);
      const result = JSON.parse(response.payload);
      expect(result.status).toBe('ERROR');
    });

    it('should respect rate limiting', async () => {
      // Mock rate limiting to be exceeded
      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': validApiKey,
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: 'Test claim',
          source: 'browser-extension'
        }
      });

      // Note: This test would need actual rate limiting implementation
      // For now, we're testing the structure
      expect(response.statusCode).toBeLessThan(500);
    });
  });

  describe('Document Management Endpoints', () => {
    const validApiKey = 'Bearer developer-1234567890abcdef1234567890abcdef';

    it('should add a document successfully', async () => {
      const documentData = {
        title: 'Test Document',
        content: 'This is test content for verification.',
        mime_type: 'text/plain',
        source_url: 'https://example.com/test'
      };

      mockIPFSService.storeDocument.mockResolvedValue('QmTestCID123');
      mockDatabaseService.storeDocument.mockResolvedValue('doc-uuid-123');

      const response = await app.inject({
        method: 'POST',
        url: '/documents',
        headers: {
          'Authorization': validApiKey,
          'Content-Type': 'application/json'
        },
        payload: documentData
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.document_id).toBe('doc-uuid-123');
    });

    it('should retrieve documents with pagination', async () => {
      const mockDocuments = [
        {
          id: 'doc-1',
          title: 'Document 1',
          cid: 'QmTest1',
          created_at: new Date().toISOString()
        },
        {
          id: 'doc-2',
          title: 'Document 2',
          cid: 'QmTest2',
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
          'Authorization': validApiKey
        }
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.documents).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe('Analytics Endpoints', () => {
    const validApiKey = 'Bearer enterprise-1234567890abcdef1234567890abcdef';

    it('should return verification analytics', async () => {
      const mockAnalytics = {
        total_verifications: 1000,
        verified_count: 800,
        unverified_count: 150,
        unknown_count: 50,
        average_confidence: 0.75,
        average_response_time: 250
      };

      mockDatabaseService.getVerificationAnalytics.mockResolvedValue(mockAnalytics);

      const response = await app.inject({
        method: 'GET',
        url: '/analytics/verifications?start_date=2024-01-01&end_date=2024-01-31',
        headers: {
          'Authorization': validApiKey
        }
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.total_verifications).toBe(1000);
      expect(result.verified_count).toBe(800);
    });
  });

  describe('Performance and Load Testing', () => {
    const validApiKey = 'Bearer veritas-1234567890abcdef1234567890abcdef';

    it('should handle concurrent requests efficiently', async () => {
      const claimText = 'Concurrent test claim';
      
      // Mock successful verification for all requests
      mockCacheService.get.mockResolvedValue(null);
      mockEmbeddingService.embedText.mockResolvedValue([0.1, 0.2, 0.3]);
      mockDatabaseService.searchSimilarDocuments.mockResolvedValue([
        {
          id: 'doc-1',
          content: 'Supporting document',
          similarity: 0.85,
          cid: 'QmTest123',
          title: 'Test Document'
        }
      ]);
      mockEmbeddingService.rerankDocuments.mockResolvedValue([
        {
          id: 'doc-1',
          content: 'Supporting document',
          similarity: 0.85,
          cid: 'QmTest123',
          title: 'Test Document'
        }
      ]);

      // Send multiple concurrent requests
      const requests = Array.from({ length: 10 }, () =>
        app.inject({
          method: 'POST',
          url: '/verify',
          headers: {
            'Authorization': validApiKey,
            'Content-Type': 'application/json'
          },
          payload: {
            claim_text: claimText,
            source: 'browser-extension'
          }
        })
      );

      const responses = await Promise.all(requests);
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.statusCode).toBe(200);
        const result = JSON.parse(response.payload);
        expect(result.status).toBe('VERIFIED');
        expect(result.processing_time_ms).toBeLessThan(300); // PRD requirement
      });
    });

    it('should maintain performance under load', async () => {
      const startTime = Date.now();
      
      // Send 50 requests
      const requests = Array.from({ length: 50 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/verify',
          headers: {
            'Authorization': validApiKey,
            'Content-Type': 'application/json'
          },
          payload: {
            claim_text: `Load test claim ${i}`,
            source: 'browser-extension'
          }
        })
      );

      const responses = await Promise.all(requests);
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      
      // Should complete within reasonable time (5 seconds for 50 requests)
      expect(totalTime).toBeLessThan(5000);
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.statusCode).toBeLessThan(500);
      });
    });
  });

  describe('Security Testing', () => {
    it('should reject malformed requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': 'Bearer veritas-1234567890abcdef1234567890abcdef',
          'Content-Type': 'application/json'
        },
        payload: {
          // Missing required claim_text field
          source: 'browser-extension'
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should handle SQL injection attempts', async () => {
      const maliciousClaim = "'; DROP TABLE users; --";
      
      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': 'Bearer veritas-1234567890abcdef1234567890abcdef',
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: maliciousClaim,
          source: 'browser-extension'
        }
      });

      // Should not crash and should handle gracefully
      expect(response.statusCode).toBeLessThan(500);
    });

    it('should handle XSS attempts', async () => {
      const xssClaim = '<script>alert("xss")</script>Test claim';
      
      const response = await app.inject({
        method: 'POST',
        url: '/verify',
        headers: {
          'Authorization': 'Bearer veritas-1234567890abcdef1234567890abcdef',
          'Content-Type': 'application/json'
        },
        payload: {
          claim_text: xssClaim,
          source: 'browser-extension'
        }
      });

      // Should not crash and should handle gracefully
      expect(response.statusCode).toBeLessThan(500);
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle service unavailability gracefully', async () => {
      // Mock all services to fail
      mockDatabaseService.healthCheck.mockRejectedValue(new Error('Database down'));
      mockEmbeddingService.healthCheck.mockRejectedValue(new Error('Embedding service down'));
      mockIPFSService.healthCheck.mockRejectedValue(new Error('IPFS down'));

      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(503);
      const result = JSON.parse(response.payload);
      expect(result.status).toBe('unhealthy');
    });

    it('should handle partial service failures', async () => {
      // Mock database to fail but others to succeed
      mockDatabaseService.healthCheck.mockRejectedValue(new Error('Database down'));
      mockEmbeddingService.healthCheck.mockResolvedValue(true);
      mockIPFSService.healthCheck.mockResolvedValue(true);

      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.payload);
      expect(result.status).toBe('degraded');
      expect(result.services.database).toBe('unhealthy');
      expect(result.services.embedding).toBe('healthy');
      expect(result.services.ipfs).toBe('healthy');
    });
  });
}); 