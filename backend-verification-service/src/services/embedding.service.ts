import { Logger } from 'winston';
import OpenAI from 'openai';

interface RerankResult {
  id: string;
  content: string;
  similarity: number;
  relevanceScore: number;
}

export class EmbeddingService {
  private openai: OpenAI;
  private modelName: string;
  private crossEncoderEndpoint: string | undefined;

  constructor(private logger: Logger) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.modelName = process.env.EMBEDDING_MODEL || 'text-embedding-ada-002';
    this.crossEncoderEndpoint = process.env.CROSS_ENCODER_ENDPOINT;
  }

  async initialize(): Promise<void> {
    try {
      // Test the embedding service
      const testEmbedding = await this.embedText('test');
      if (testEmbedding.length === 0) {
        throw new Error('Failed to generate test embedding');
      }
      
      this.logger.info('Embedding service initialized successfully');
    } catch (error) {
      this.logger.error('Embedding service initialization failed:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.embedText('health check');
      return true;
    } catch (error) {
      this.logger.error('Embedding service health check failed:', error);
      return false;
    }
  }

  async embedText(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: this.modelName,
        input: text,
      });

      if (response.data && response.data[0]) {
        return response.data[0].embedding;
      }
      return [];
    } catch (error) {
      this.logger.error('Failed to generate embedding:', error);
      throw error;
    }
  }

  async rerankDocuments(
    query: string,
    documents: Array<{ id: string; content: string; similarity: number }>
  ): Promise<Array<{ id: string; content: string; similarity: number; relevanceScore: number }>> {
    try {
      if (documents.length === 0) {
        return documents.map(doc => ({ ...doc, relevanceScore: doc.similarity }));
      }

      // If we have a cross-encoder endpoint, use it for more accurate reranking
      if (this.crossEncoderEndpoint) {
        return await this.crossEncoderRerank(query, documents);
      }

      // Fallback to semantic similarity-based reranking
      return await this.semanticRerank(query, documents);
    } catch (error) {
      this.logger.error('Failed to rerank documents:', error);
      return documents.map(doc => ({ ...doc, relevanceScore: doc.similarity })); // Fallback to original order
    }
  }

  private async crossEncoderRerank(
    query: string,
    documents: Array<{ id: string; content: string; similarity: number }>
  ): Promise<RerankResult[]> {
    try {
      if (!this.crossEncoderEndpoint) {
        throw new Error('Cross-encoder endpoint not configured');
      }

      // Prepare pairs for cross-encoder
      const pairs = documents.map(doc => ({
        query,
        passage: doc.content,
        id: doc.id,
        originalSimilarity: doc.similarity
      }));

      // Call cross-encoder service
      const response = await fetch(this.crossEncoderEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pairs: pairs.map(p => [p.query, p.passage])
        }),
      });

      if (!response.ok) {
        throw new Error(`Cross-encoder API returned ${response.status}`);
      }

      const { scores } = await response.json();

      // Combine scores with original documents
      const rankedDocuments = documents.map((doc, index) => ({
        id: doc.id,
        content: doc.content,
        similarity: doc.similarity,
        relevanceScore: scores[index] || 0
      }));

      // Sort by relevance score (descending)
      rankedDocuments.sort((a, b) => b.relevanceScore - a.relevanceScore);

      this.logger.debug('Documents reranked using cross-encoder', {
        originalCount: documents.length,
        rerankedCount: rankedDocuments.length,
        topScore: rankedDocuments.length > 0 ? rankedDocuments[0]?.relevanceScore || 0 : 0
      });

      return rankedDocuments;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Cross-encoder reranking failed:', { error: errorMessage });
      // Fallback to semantic reranking
      return await this.semanticRerank(query, documents);
    }
  }

  private async semanticRerank(
    query: string,
    documents: Array<{ id: string; content: string; similarity: number }>
  ): Promise<Array<{ id: string; content: string; similarity: number; relevanceScore: number }>> {
    try {
      // Generate query embedding
      const queryEmbedding = await this.embedText(query);

      // Generate embeddings for document contents and calculate similarities
      const rerankedDocuments = await Promise.all(
        documents.map(async (doc) => {
          try {
            const docEmbedding = await this.embedText(doc.content);
            const semanticSimilarity = this.cosineSimilarity(queryEmbedding, docEmbedding);
            
            // Combine original similarity with semantic similarity
            const combinedScore = (doc.similarity * 0.6) + (semanticSimilarity * 0.4);
            
            return {
              id: doc.id,
              content: doc.content,
              similarity: doc.similarity,
              relevanceScore: combinedScore
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.warn('Failed to rerank document:', { docId: doc.id, error: errorMessage });
            return {
              id: doc.id,
              content: doc.content,
              similarity: doc.similarity,
              relevanceScore: doc.similarity
            };
          }
        })
      );

      // Sort by combined relevance score (descending)
      rerankedDocuments.sort((a, b) => b.relevanceScore - a.relevanceScore);

      this.logger.debug('Documents reranked using semantic similarity', {
        originalCount: documents.length,
        rerankedCount: rerankedDocuments.length,
        topScore: rerankedDocuments.length > 0 ? rerankedDocuments[0]?.relevanceScore || 0 : 0
      });

      return rerankedDocuments;
    } catch (error) {
      this.logger.error('Semantic reranking failed:', error);
      return documents.map(doc => ({ ...doc, relevanceScore: doc.similarity }));
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] ?? 0;
      const bVal = b[i] ?? 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const response = await this.openai.embeddings.create({
        model: this.modelName,
        input: texts,
      });

      return response.data.map(item => item.embedding);
    } catch (error) {
      this.logger.error('Failed to generate batch embeddings:', error);
      throw error;
    }
  }

  async calculateSemanticSimilarity(text1: string, text2: string): Promise<number> {
    try {
      const [embedding1, embedding2] = await Promise.all([
        this.embedText(text1),
        this.embedText(text2)
      ]);

      return this.cosineSimilarity(embedding1, embedding2);
    } catch (error) {
      this.logger.error('Failed to calculate semantic similarity:', error);
      return 0;
    }
  }

  async extractKeywords(text: string): Promise<string[]> {
    try {
      // Use OpenAI to extract key terms/concepts
      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "Extract the most important keywords and concepts from the given text. Return only a comma-separated list of keywords, no other text."
          },
          {
            role: "user",
            content: text
          }
        ],
        max_tokens: 100,
        temperature: 0.3
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return [];
      }

      const keywords = content.split(',').map(k => k.trim());
      return keywords.filter(k => k.length > 0);
    } catch (error) {
      this.logger.error('Failed to extract keywords:', error);
      return [];
    }
  }
} 