import { DatabaseService } from './database.service';
import { EmbeddingService } from './embedding.service';
import { IPFSService } from './ipfs.service';
import { MetricsService } from './metrics.service';
import { ValidationService } from './validation.service';
import { CacheService } from './cache.service';
import { Logger } from 'winston';

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
}

export interface DocumentInput {
  title: string;
  content: string;
  mime_type: string;
  source_url?: string;
}

export class VerificationService {
  private readonly confidenceThresholds = {
    verified: 0.8,
    unverified: 0.5
  };

  constructor(
    private databaseService: DatabaseService,
    private embeddingService: EmbeddingService,
    private ipfsService: IPFSService,
    private metricsService: MetricsService,
    private validationService: ValidationService,
    private cacheService: CacheService,
    private logger: Logger
  ) {}

  async verifyClaim(claimText: string, source?: string): Promise<VerificationResult> {
    const startTime = Date.now();
    
    try {
      // Validate input
      if (!this.validationService.validateClaim(claimText)) {
        throw new Error('Invalid claim text provided');
      }

      // Generate embedding for the claim
      const claimEmbedding = await this.embeddingService.embedText(claimText);
      
      // Search for similar documents in vector database
      const similarDocuments = await this.databaseService.searchSimilarDocuments(
        claimEmbedding,
        { limit: 10, similarityThreshold: 0.3 }
      );

      if (similarDocuments.length === 0) {
        this.logger.info('No similar documents found', { claimLength: claimText.length });
        return {
          status: 'UNKNOWN',
          confidence: 0.0,
          citations: []
        };
      }

      // Re-rank results using cross-encoder if available
      const rerankedDocuments = await this.embeddingService.rerankDocuments(
        claimText,
        similarDocuments
      );

      // Calculate confidence scores
      const confidenceScores = await this.calculateConfidenceScores(
        claimText,
        rerankedDocuments
      );

      // Determine overall status and confidence
      const { status, confidence } = this.determineVerificationStatus(confidenceScores);

      // Prepare citations
      const citations = await this.prepareCitations(rerankedDocuments, confidenceScores);

      // Record metrics
      this.metricsService.recordVerificationMetrics({
        claimLength: claimText.length,
        documentsFound: similarDocuments.length,
        processingTimeMs: Date.now() - startTime,
        status,
        confidence
      });

      return {
        status,
        confidence,
        citations
      };

    } catch (error) {
      this.logger.error('Verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        claimLength: claimText.length,
        source
      });
      throw error;
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

  private async calculateConfidenceScores(
    claimText: string,
    documents: any[]
  ): Promise<Array<{ documentId: string; score: number }>> {
    const scores: Array<{ documentId: string; score: number }> = [];
    
    for (const doc of documents) {
      try {
        // Calculate semantic similarity
        const semanticScore = doc.similarity;
        
        // Calculate text overlap score
        const overlapScore = this.calculateTextOverlap(claimText, doc.content);
        
        // Calculate keyword matching score
        const keywordScore = this.calculateKeywordMatch(claimText, doc.content);
        
        // Combine scores with weights
        const combinedScore = (
          semanticScore * 0.6 +
          overlapScore * 0.3 +
          keywordScore * 0.1
        );
        
        scores.push({
          documentId: doc.id,
          score: Math.min(combinedScore, 1.0)
        });
        
      } catch (error) {
        this.logger.warn('Failed to calculate confidence for document', {
          documentId: doc.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        scores.push({ documentId: doc.id, score: 0.0 });
      }
    }
    
    return scores.sort((a, b) => b.score - a.score);
  }

  private calculateTextOverlap(claimText: string, documentText: string): number {
    const claimWords = new Set(claimText.toLowerCase().split(/\s+/));
    const docWords = documentText.toLowerCase().split(/\s+/);
    
    let matches = 0;
    for (const word of docWords) {
      if (claimWords.has(word)) {
        matches++;
      }
    }
    
    return Math.min(matches / claimWords.size, 1.0);
  }

  private calculateKeywordMatch(claimText: string, documentText: string): number {
    // Extract key entities and facts from claim
    const claimEntities = this.extractEntities(claimText);
    const docEntities = this.extractEntities(documentText);
    
    if (claimEntities.length === 0) return 0.0;
    
    let matches = 0;
    for (const entity of claimEntities) {
      if (docEntities.includes(entity)) {
        matches++;
      }
    }
    
    return matches / claimEntities.length;
  }

  private extractEntities(text: string): string[] {
    // Simple entity extraction (in production, use NER models)
    const entities: string[] = [];
    
    // Extract capitalized phrases (potential proper nouns)
    const capitalizedMatches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
    if (capitalizedMatches) {
      entities.push(...capitalizedMatches);
    }
    
    // Extract numbers and dates
    const numberMatches = text.match(/\b\d+(?:\.\d+)?\b/g);
    if (numberMatches) {
      entities.push(...numberMatches);
    }
    
    return entities;
  }

  private determineVerificationStatus(
    confidenceScores: Array<{ documentId: string; score: number }>
  ): { status: 'VERIFIED' | 'UNVERIFIED' | 'UNKNOWN'; confidence: number } {
    if (confidenceScores.length === 0) {
      return { status: 'UNKNOWN', confidence: 0.0 };
    }
    
    const maxScore = confidenceScores[0] ? confidenceScores[0].score : 0;
    
    if (maxScore >= this.confidenceThresholds.verified) {
      return { status: 'VERIFIED', confidence: maxScore };
    } else if (maxScore >= this.confidenceThresholds.unverified) {
      return { status: 'UNVERIFIED', confidence: maxScore };
    } else {
      return { status: 'UNKNOWN', confidence: maxScore };
    }
  }

  private async prepareCitations(
    documents: any[],
    confidenceScores: Array<{ documentId: string; score: number }>
  ): Promise<VerificationResult['citations']> {
    const citations: VerificationResult['citations'] = [];
    
    for (const doc of documents.slice(0, 5)) { // Limit to top 5 citations
      const score = confidenceScores.find(s => s.documentId === doc.id)?.score || 0.0;
      
      if (score > 0.3) { // Only include relevant citations
        const snippet = this.extractRelevantSnippet(doc.content, 200);
        
        citations.push({
          doc_id: doc.id,
          cid: doc.cid,
          title: doc.title,
          snippet,
          similarity: score
        });
      }
    }
    
    return citations;
  }

  private extractRelevantSnippet(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }
    
    // Find the middle portion of the content
    const start = Math.floor((content.length - maxLength) / 2);
    const snippet = content.substring(start, start + maxLength);
    
    // Try to break at word boundaries
    const firstSpace = snippet.indexOf(' ');
    const lastSpace = snippet.lastIndexOf(' ');
    
    if (firstSpace > 0 && lastSpace > firstSpace) {
      return snippet.substring(firstSpace + 1, lastSpace);
    }
    
    return snippet;
  }
} 