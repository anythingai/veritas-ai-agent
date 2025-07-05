import { Logger } from 'winston';
import OpenAI from 'openai';

export class EmbeddingService {
  private openai: OpenAI;
  private modelName: string;

  constructor(private logger: Logger) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.modelName = process.env.EMBEDDING_MODEL || 'text-embedding-ada-002';
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
  ): Promise<Array<{ id: string; content: string; similarity: number }>> {
    try {
      // For now, return documents as-is
      // In production, implement cross-encoder reranking
      return documents;
    } catch (error) {
      this.logger.error('Failed to rerank documents:', error);
      return documents; // Fallback to original order
    }
  }
} 