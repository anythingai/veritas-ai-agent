import { DatabaseService } from './database.service';
import { EmbeddingService } from './embedding.service';
import { IPFSService } from './ipfs.service';
import { MetricsService } from './metrics.service';
import { ValidationService } from './validation.service';
import { CacheService } from './cache.service';
import { Logger } from 'winston';
import { CircuitBreaker, GracefulDegradation } from '../middleware/error-handler';

export interface VerificationResult {
  status: 'VERIFIED' | 'UNVERIFIED' | 'UNKNOWN';
  confidence: number;
  citations: Array<{
    doc_id: string;
    cid: string;
    title: string;
    snippet: string;
    similarity: number;
  }>;
  cached?: boolean;
  processing_time_ms?: number;
}

export interface DocumentInput {
  title: string;
  content: string;
  mime_type: string;
  source_url?: string;
}

interface VerificationMetrics {
  cacheHitRate: number;
  averageProcessingTime: number;
  totalRequests: number;
  errorRate: number;
}

export class VerificationService {
  private readonly confidenceThresholds = {
    verified: 0.8,
    unverified: 0.5
  };

  private circuitBreaker: CircuitBreaker;
  private gracefulDegradation: GracefulDegradation;
  private batchProcessor: BatchProcessor;
  private performanceMonitor: PerformanceMonitor;

  constructor(
    private databaseService: DatabaseService,
    private embeddingService: EmbeddingService,
    private ipfsService: IPFSService,
    private metricsService: MetricsService,
    private validationService: ValidationService,
    private cacheService: CacheService,
    private logger: Logger
  ) {
    this.circuitBreaker = new CircuitBreaker(5, 30000, 10000, logger);
    this.gracefulDegradation = new GracefulDegradation(logger);
    this.batchProcessor = new BatchProcessor(logger);
    this.performanceMonitor = new PerformanceMonitor(logger);
  }

  async verifyClaim(claimText: string, source?: string): Promise<VerificationResult> {
    const startTime = Date.now();
    const performanceTrace = this.performanceMonitor.startTrace('verify_claim');
    
    try {
      // Input validation with early return
      if (!this.validationService.validateClaim(claimText)) {
        throw new Error('Invalid claim text provided');
      }

      // Check cache first for fastest response
      const cachedResult = await this.checkCache(claimText);
      if (cachedResult) {
        performanceTrace.end({ cached: true });
        return {
          ...cachedResult,
          cached: true,
          processing_time_ms: Math.max(Date.now() - startTime, 1)
        };
      }

      // Perform verification with circuit breaker and graceful degradation
      const result = await this.circuitBreaker.execute(
        () => this.performVerification(claimText, source),
        () => this.getFallbackResult(claimText)
      );

      // Cache the result asynchronously (fire and forget)
      this.cacheResult(claimText, result).catch(error => 
        this.logger.warn('Failed to cache verification result:', error)
      );

      const processingTime = Math.max(Date.now() - startTime, 1);
      performanceTrace.end({ 
        cached: false, 
        status: result.status, 
        processingTime 
      });

      return {
        ...result,
        cached: false,
        processing_time_ms: processingTime
      };

    } catch (error) {
      const processingTime = Math.max(Date.now() - startTime, 1);
      performanceTrace.error(error instanceof Error ? error.message : 'Unknown error');
      
      this.logger.error('Verification failed', {
        claimLength: claimText.length,
        source,
        processingTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Return graceful degradation result
      return {
        status: 'UNKNOWN',
        confidence: 0.0,
        citations: [],
        cached: false,
        processing_time_ms: processingTime
      };
    }
  }

  private async checkCache(claimText: string): Promise<VerificationResult | null> {
    try {
      const cached = await this.cacheService.getCachedVerificationResult(claimText);
      if (cached) {
        this.logger.debug('Cache hit for verification', { 
          claimLength: claimText.length,
          status: cached.status 
        });
        return {
          status: cached.status,
          confidence: cached.confidence,
          citations: cached.citations
        };
      }
      return null;
    } catch (error) {
      this.logger.warn('Cache check failed, proceeding without cache:', error);
      return null;
    }
  }

  private async cacheResult(claimText: string, result: VerificationResult): Promise<void> {
    try {
      // Only cache successful results with reasonable confidence
      if (result.status !== 'UNKNOWN' && result.confidence > 0.3) {
        await this.cacheService.cacheVerificationResult(claimText, {
          status: result.status,
          confidence: result.confidence,
          citations: result.citations
        }, { ttl: 300 }); // 5 minutes TTL
      }
    } catch (error) {
      // Cache failures shouldn't affect the main flow
      this.logger.debug('Cache storage failed:', error);
    }
  }

  private async performVerification(claimText: string, source?: string): Promise<VerificationResult> {
    const performanceTrace = this.performanceMonitor.startTrace('perform_verification');
    
    try {
      // Generate embedding with timeout
      const claimEmbedding = await Promise.race([
        this.embeddingService.embedText(claimText),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Embedding timeout')), 10000)
        )
      ]);

      performanceTrace.addData({ embeddingGenerated: true });

      // Check cache for similar embeddings
      const cachedSearchResults = await this.cacheService.getCachedSearchResults(claimEmbedding);
      let similarDocuments;

      if (cachedSearchResults) {
        similarDocuments = cachedSearchResults;
        performanceTrace.addData({ searchCacheHit: true });
      } else {
        // Search for similar documents with optimized query
        similarDocuments = await this.databaseService.searchSimilarDocuments(
          claimEmbedding,
          { limit: 10, similarityThreshold: 0.3 }
        );

        // Cache search results asynchronously
        this.cacheService.cacheSearchResults(claimEmbedding, similarDocuments)
          .catch(error => this.logger.debug('Search cache failed:', error));
        
        performanceTrace.addData({ searchCacheHit: false, documentsFound: similarDocuments.length });
      }

      if (similarDocuments.length === 0) {
        performanceTrace.end({ result: 'no_documents' });
        return {
          status: 'UNKNOWN',
          confidence: 0.0,
          citations: []
        };
      }

      // Re-rank results with timeout and fallback
      const rerankedDocuments = await this.gracefulDegradation.withFallback(
        () => this.embeddingService.rerankDocuments(claimText, similarDocuments),
        () => Promise.resolve(similarDocuments.map(doc => ({ ...doc, relevanceScore: doc.similarity })))
      );

      performanceTrace.addData({ reranked: true, topDocuments: rerankedDocuments.slice(0, 3).length });

      // Calculate confidence scores efficiently
      const confidenceScores = await this.calculateConfidenceScoresOptimized(
        claimText,
        rerankedDocuments.slice(0, 5) // Limit to top 5 for performance
      );

      // Determine overall status and confidence
      const { status, confidence } = this.determineVerificationStatus(confidenceScores);

      // Prepare citations efficiently
      const citations = await this.prepareCitationsOptimized(
        rerankedDocuments.slice(0, 3), // Limit to top 3 citations
        confidenceScores
      );

      performanceTrace.end({ 
        result: 'success', 
        status, 
        confidence, 
        citationsCount: citations.length 
      });

      return {
        status,
        confidence,
        citations
      };

    } catch (error) {
      performanceTrace.error(error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  private async getFallbackResult(claimText: string): Promise<VerificationResult> {
    this.logger.warn('Using fallback verification result', { claimLength: claimText.length });
    
    // Return a conservative result when primary verification fails
    return {
      status: 'UNKNOWN',
      confidence: 0.0,
      citations: []
    };
  }

  private async calculateConfidenceScoresOptimized(
    claimText: string,
    documents: any[]
  ): Promise<Array<{ documentId: string; score: number }>> {
    const scores: Array<{ documentId: string; score: number }> = [];
    
    // Use batch processing for efficiency
    const batches = this.batchProcessor.createBatches(documents, 3);
    
    for (const batch of batches) {
      const batchScores = await Promise.all(
        batch.map(async (doc) => {
          try {
            // Use relevance score if available from reranking
            const baseScore = doc.relevanceScore || doc.similarity;
            
            // Apply quick heuristics for additional scoring
            const lengthScore = this.calculateLengthScore(claimText, doc.content);
            const keywordScore = this.calculateQuickKeywordMatch(claimText, doc.content);
            
            // Weighted combination optimized for speed
            const finalScore = (baseScore * 0.6) + (lengthScore * 0.2) + (keywordScore * 0.2);
            
            return {
              documentId: doc.id,
              score: Math.min(Math.max(finalScore, 0), 1) // Clamp between 0 and 1
            };
          } catch (error) {
            this.logger.warn('Failed to calculate confidence score for document:', { 
              docId: doc.id, 
              error: error instanceof Error ? error.message : 'Unknown error'
            });
            return {
              documentId: doc.id,
              score: 0.1 // Conservative score for failed calculations
            };
          }
        })
      );
      
      scores.push(...batchScores);
    }
    
    return scores.sort((a, b) => b.score - a.score);
  }

  private calculateLengthScore(claimText: string, documentText: string): number {
    const claimLength = claimText.length;
    const docLength = documentText.length;
    
    // Optimal document length relative to claim length
    const optimalRatio = 3; // Documents should be ~3x longer than claims
    const actualRatio = docLength / claimLength;
    
    // Score based on how close to optimal ratio
    return Math.max(0, 1 - Math.abs(actualRatio - optimalRatio) / optimalRatio);
  }

  private calculateQuickKeywordMatch(claimText: string, documentText: string): number {
    const claimWords = claimText.toLowerCase().split(/\s+/).filter(word => word.length > 3);
    const docWords = new Set(documentText.toLowerCase().split(/\s+/));
    
    const matches = claimWords.filter(word => docWords.has(word));
    return claimWords.length > 0 ? matches.length / claimWords.length : 0;
  }

  private determineVerificationStatus(
    confidenceScores: Array<{ documentId: string; score: number }>
  ): { status: 'VERIFIED' | 'UNVERIFIED' | 'UNKNOWN'; confidence: number } {
    if (confidenceScores.length === 0) {
      return { status: 'UNKNOWN', confidence: 0.0 };
    }

    // Use weighted average of top scores for overall confidence
    const topScores = confidenceScores.slice(0, 3);
    const weights = [0.5, 0.3, 0.2]; // Decreasing weights for top documents
    
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < Math.min(topScores.length, weights.length); i++) {
      const score = topScores[i]?.score || 0;
      const weight = weights[i] || 0;
      weightedSum += score * weight;
      totalWeight += weight;
    }
    
    const confidence = totalWeight > 0 ? weightedSum / totalWeight : 0;

    if (confidence >= this.confidenceThresholds.verified) {
      return { status: 'VERIFIED', confidence };
    } else if (confidence >= this.confidenceThresholds.unverified) {
      return { status: 'UNVERIFIED', confidence };
    } else {
      return { status: 'UNKNOWN', confidence };
    }
  }

  private async prepareCitationsOptimized(
    documents: any[],
    confidenceScores: Array<{ documentId: string; score: number }>
  ): Promise<VerificationResult['citations']> {
    const citations: VerificationResult['citations'] = [];
    const maxCitations = 3; // Limit for performance
    
    // Create lookup map for quick access
    const scoreMap = new Map(confidenceScores.map(cs => [cs.documentId, cs.score]));
    
    for (let i = 0; i < Math.min(documents.length, maxCitations); i++) {
      const doc = documents[i];
      const score = scoreMap.get(doc.id) || 0;
      
      try {
        // Get document metadata efficiently
        const documentData = await this.databaseService.getDocuments(1, 1); // Implement efficient single doc fetch
        const snippet = this.extractRelevantSnippetOptimized(doc.content, 150);
        
        citations.push({
          doc_id: doc.id,
          cid: doc.cid || 'unknown',
          title: doc.title || 'Untitled Document',
          snippet,
          similarity: score
        });
      } catch (error) {
        this.logger.warn('Failed to prepare citation:', { 
          docId: doc.id, 
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    return citations;
  }

  private extractRelevantSnippetOptimized(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }
    
    // Find a good breaking point near the middle
    const midPoint = maxLength / 2;
    let breakPoint = midPoint;
    
    // Look for sentence endings within reasonable range
    for (let i = midPoint; i < Math.min(content.length, maxLength - 20); i++) {
      if (content[i] === '.' || content[i] === '!' || content[i] === '?') {
        breakPoint = i + 1;
        break;
      }
    }
    
    return content.substring(0, breakPoint).trim() + (breakPoint < content.length ? '...' : '');
  }

  async getPerformanceMetrics(): Promise<VerificationMetrics> {
    try {
      const cacheStats = await this.cacheService.getCacheStats();
      const performanceStats = this.performanceMonitor.getStats();
      
      return {
        cacheHitRate: cacheStats.verificationKeys > 0 ? 
          (performanceStats.cacheHits / (performanceStats.cacheHits + performanceStats.cacheMisses)) : 0,
        averageProcessingTime: performanceStats.averageResponseTime,
        totalRequests: performanceStats.totalRequests,
        errorRate: performanceStats.totalRequests > 0 ? 
          (performanceStats.errors / performanceStats.totalRequests) : 0
      };
    } catch (error) {
      this.logger.error('Failed to get performance metrics:', error);
      return {
        cacheHitRate: 0,
        averageProcessingTime: 0,
        totalRequests: 0,
        errorRate: 0
      };
    }
  }

  async addDocument(document: DocumentInput): Promise<string> {
    const startTime = Date.now();
    
    try {
      // Validate document
      if (!this.validationService.validateDocument(document)) {
        throw new Error('Invalid document provided');
      }

      // Generate embeddings for document chunks
      const chunks = this.chunkDocument(document.content);
      const chunkEmbeddings = await Promise.all(
        chunks.map(chunk => this.embeddingService.embedText(chunk))
      );

      // Store document in IPFS
      const cid = await this.ipfsService.storeDocument(document.content);

      // Store document and embeddings in database
      const documentId = await this.databaseService.storeDocument({
        cid,
        title: document.title,
        mime_type: document.mime_type,
        source_url: document.source_url || '',
        content: '',
        chunks,
        chunk_embeddings: chunkEmbeddings
      });

      this.logger.info('Document added successfully', {
        documentId,
        title: document.title,
        chunksCount: chunks.length,
        cid,
        processingTimeMs: Date.now() - startTime
      });

      return documentId;

    } catch (error) {
      this.logger.error('Document addition failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        title: document.title
      });
      throw error;
    }
  }

  generateCacheKey(claimText: string): string {
    // Create a normalized hash of the claim text
    const normalizedText = claimText.toLowerCase().trim().replace(/\s+/g, ' ');
    return Buffer.from(normalizedText).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
  }

  private chunkDocument(content: string): string[] {
    const maxChunkSize = 500; // tokens
    const overlap = 20; // tokens
    
    // Simple tokenization (in production, use a proper tokenizer)
    const tokens = content.split(/\s+/);
    const chunks: string[] = [];
    
    for (let i = 0; i < tokens.length; i += maxChunkSize - overlap) {
      const chunk = tokens.slice(i, i + maxChunkSize).join(' ');
      if (chunk.trim()) {
        chunks.push(chunk);
      }
    }
    
    return chunks;
  }
} 

// Helper classes for performance optimization
class BatchProcessor {
  constructor(private logger: Logger) {}

  createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    batchSize: number = 5
  ): Promise<R[]> {
    const batches = this.createBatches(items, batchSize);
    const results: R[] = [];

    for (const batch of batches) {
      try {
        const batchResults = await Promise.all(batch.map(processor));
        results.push(...batchResults);
      } catch (error) {
        this.logger.error('Batch processing failed:', error);
        throw error;
      }
    }

    return results;
  }
}

class PerformanceMonitor {
  private traces: Map<string, { startTime: number; data: any }> = new Map();
  private stats = {
    totalRequests: 0,
    errors: 0,
    cacheHits: 0,
    cacheMisses: 0,
    responseTimes: [] as number[],
    averageResponseTime: 0
  };

  constructor(private logger: Logger) {}

  startTrace(name: string): PerformanceTrace {
    const traceId = `${name}_${Date.now()}_${Math.random()}`;
    this.traces.set(traceId, { startTime: Date.now(), data: {} });
    
    return new PerformanceTrace(traceId, this);
  }

  endTrace(traceId: string, data?: any): void {
    const trace = this.traces.get(traceId);
    if (trace) {
      const duration = Date.now() - trace.startTime;
      this.updateStats(duration, data);
      this.traces.delete(traceId);
    }
  }

  errorTrace(traceId: string, error: string): void {
    this.stats.errors++;
    this.traces.delete(traceId);
  }

  private updateStats(duration: number, data?: any): void {
    this.stats.totalRequests++;
    this.stats.responseTimes.push(duration);
    
    // Keep only last 1000 response times for memory efficiency
    if (this.stats.responseTimes.length > 1000) {
      this.stats.responseTimes = this.stats.responseTimes.slice(-1000);
    }
    
    this.stats.averageResponseTime = this.stats.responseTimes.reduce((a, b) => a + b, 0) / this.stats.responseTimes.length;
    
    if (data?.cached === true) {
      this.stats.cacheHits++;
    } else if (data?.cached === false) {
      this.stats.cacheMisses++;
    }
  }

  getStats() {
    return { ...this.stats };
  }
}

class PerformanceTrace {
  constructor(
    private traceId: string,
    private monitor: PerformanceMonitor
  ) {}

  addData(data: any): void {
    // Can be used to add contextual data to traces
  }

  end(data?: any): void {
    this.monitor.endTrace(this.traceId, data);
  }

  error(error: string): void {
    this.monitor.errorTrace(this.traceId, error);
  }
} 