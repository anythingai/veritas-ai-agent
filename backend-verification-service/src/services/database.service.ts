import { Pool, PoolClient } from 'pg';
import { Logger } from 'winston';

export interface Document {
  id: string;
  cid: string;
  title: string;
  mime_type: string;
  source_url?: string;
  content: string;
  chunks: string[];
  chunk_embeddings: number[][];
  created_at: Date;
}

export interface VerificationRequest {
  id: string;
  claim_text: string;
  confidence: number;
  status: 'VERIFIED' | 'UNVERIFIED' | 'UNKNOWN';
  doc_ids: string[];
  source?: string;
  extension_version?: string;
  processing_time_ms: number;
  created_at: Date;
}

export interface SearchOptions {
  limit: number;
  similarityThreshold: number;
}

export interface ApiKey {
  id: string;
  key: string;
  userId: string;
  organization: string;
  permissions: string[];
  tier: string;
  dailyQuota: number;
  monthlyQuota: number;
  rateLimit: number;
  isActive: boolean;
  expiresAt?: Date;
  createdAt: Date;
  lastUsedAt?: Date;
}

export interface ApiKeyUsage {
  id: string;
  apiKeyId: string;
  dailyUsage: number;
  monthlyUsage: number;
  usageDate: string;
  usageMonth: string;
}

export class DatabaseService {
  constructor(private pool: Pool, private logger: Logger) {}

  async initialize(): Promise<void> {
    try {
      // Test connection
      await this.pool.query('SELECT NOW()');
      this.logger.info('Database connection established');
      
      // Ensure pgvector extension is installed
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      
      // Create tables if they don't exist
      await this.createTables();
      
      this.logger.info('Database initialized successfully');
    } catch (error) {
      this.logger.error('Database initialization failed:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.error('Database health check failed:', error);
      return false;
    }
  }

  async storeDocument(document: Omit<Document, 'id' | 'created_at'>): Promise<string> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Insert document
      const docResult = await client.query(
        `INSERT INTO source_documents (cid, title, mime_type, source_url, content)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [document.cid, document.title, document.mime_type, document.source_url, document.content]
      );
      
      const documentId = docResult.rows[0].id;
      
      // Store embeddings for each chunk
      for (let i = 0; i < document.chunks.length; i++) {
        const chunk = document.chunks[i];
        const embedding = document.chunk_embeddings[i];
        
        await client.query(
          `INSERT INTO document_chunks (document_id, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4)`,
          [documentId, i, chunk, embedding]
        );
      }
      
      await client.query('COMMIT');
      
      this.logger.info('Document stored successfully', { documentId, title: document.title });
      return documentId;
      
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to store document:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async searchSimilarDocuments(
    queryEmbedding: number[],
    options: SearchOptions
  ): Promise<Array<Document & { similarity: number }>> {
    try {
      const result = await this.pool.query(
        `SELECT 
           sd.id,
           sd.cid,
           sd.title,
           sd.mime_type,
           sd.source_url,
           sd.content,
           dc.content as chunk_content,
           dc.embedding <-> $1 as similarity
         FROM source_documents sd
         JOIN document_chunks dc ON sd.id = dc.document_id
         WHERE dc.embedding <-> $1 < $2
         ORDER BY similarity ASC
         LIMIT $3`,
        [queryEmbedding, 1 - options.similarityThreshold, options.limit]
      );
      
      // Group by document and get the best similarity score
      const documents = new Map<string, any>();
      
      for (const row of result.rows) {
        if (!documents.has(row.id)) {
          documents.set(row.id, {
            id: row.id,
            cid: row.cid,
            title: row.title,
            mime_type: row.mime_type,
            source_url: row.source_url,
            content: row.content,
            similarity: row.similarity
          });
        } else {
          // Keep the best (lowest) similarity score
          const existing = documents.get(row.id);
          if (row.similarity < existing.similarity) {
            existing.similarity = row.similarity;
          }
        }
      }
      
      return Array.from(documents.values()).sort((a, b) => a.similarity - b.similarity);
      
    } catch (error) {
      this.logger.error('Similarity search failed:', error);
      throw error;
    }
  }

  async storeVerificationRequest(request: VerificationRequest): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO verification_requests 
         (id, claim_text, confidence, status, doc_ids, source, extension_version, processing_time_ms, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          request.id,
          request.claim_text,
          request.confidence,
          request.status,
          request.doc_ids,
          request.source,
          request.extension_version,
          request.processing_time_ms,
          request.created_at
        ]
      );
      
      this.logger.debug('Verification request stored', { requestId: request.id });
      
    } catch (error) {
      this.logger.error('Failed to store verification request:', error);
      throw error;
    }
  }

  async getDocuments(page: number = 1, limit: number = 20): Promise<{
    documents: Document[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const offset = (page - 1) * limit;
      
      // Get total count
      const countResult = await this.pool.query('SELECT COUNT(*) FROM source_documents');
      const total = parseInt(countResult.rows[0].count);
      
      // Get documents
      const result = await this.pool.query(
        `SELECT id, cid, title, mime_type, source_url, content, created_at
         FROM source_documents
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      
      return {
        documents: result.rows.map(row => ({
          ...row,
          chunks: [],
          chunk_embeddings: []
        })),
        total,
        page,
        totalPages: Math.ceil(total / limit)
      };
      
    } catch (error) {
      this.logger.error('Failed to get documents:', error);
      throw error;
    }
  }

  async getVerificationAnalytics(
    startDate?: string,
    endDate?: string,
    source?: string
  ): Promise<{
    totalRequests: number;
    verifiedCount: number;
    unverifiedCount: number;
    unknownCount: number;
    averageConfidence: number;
    averageProcessingTime: number;
    requestsBySource: Record<string, number>;
    requestsByDate: Array<{ date: string; count: number }>;
  }> {
    try {
      let whereClause = 'WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;
      
      if (startDate) {
        whereClause += ` AND created_at >= $${paramIndex++}`;
        params.push(startDate);
      }
      
      if (endDate) {
        whereClause += ` AND created_at <= $${paramIndex++}`;
        params.push(endDate);
      }
      
      if (source) {
        whereClause += ` AND source = $${paramIndex++}`;
        params.push(source);
      }
      
      // Get basic stats
      const statsResult = await this.pool.query(
        `SELECT 
           COUNT(*) as total_requests,
           COUNT(CASE WHEN status = 'VERIFIED' THEN 1 END) as verified_count,
           COUNT(CASE WHEN status = 'UNVERIFIED' THEN 1 END) as unverified_count,
           COUNT(CASE WHEN status = 'UNKNOWN' THEN 1 END) as unknown_count,
           AVG(confidence) as avg_confidence,
           AVG(processing_time_ms) as avg_processing_time
         FROM verification_requests
         ${whereClause}`,
        params
      );
      
      const stats = statsResult.rows[0];
      
      // Get requests by source
      const sourceResult = await this.pool.query(
        `SELECT source, COUNT(*) as count
         FROM verification_requests
         ${whereClause}
         GROUP BY source
         ORDER BY count DESC`,
        params
      );
      
      const requestsBySource: Record<string, number> = {};
      sourceResult.rows.forEach(row => {
        requestsBySource[row.source || 'unknown'] = parseInt(row.count);
      });
      
      // Get requests by date
      const dateResult = await this.pool.query(
        `SELECT 
           DATE(created_at) as date,
           COUNT(*) as count
         FROM verification_requests
         ${whereClause}
         GROUP BY DATE(created_at)
         ORDER BY date DESC
         LIMIT 30`,
        params
      );
      
      return {
        totalRequests: parseInt(stats.total_requests),
        verifiedCount: parseInt(stats.verified_count),
        unverifiedCount: parseInt(stats.unverified_count),
        unknownCount: parseInt(stats.unknown_count),
        averageConfidence: parseFloat(stats.avg_confidence) || 0,
        averageProcessingTime: parseFloat(stats.avg_processing_time) || 0,
        requestsBySource,
        requestsByDate: dateResult.rows.map(row => ({
          date: row.date,
          count: parseInt(row.count)
        }))
      };
      
    } catch (error) {
      this.logger.error('Failed to get verification analytics:', error);
      throw error;
    }
  }

  async getUniqueUsers(startDate?: string, endDate?: string): Promise<number> {
    try {
      let whereClause = 'WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;
      
      if (startDate) {
        whereClause += ` AND created_at >= $${paramIndex++}`;
        params.push(startDate);
      }
      
      if (endDate) {
        whereClause += ` AND created_at <= $${paramIndex++}`;
        params.push(endDate);
      }
      
      const uniqueUsersQuery = `
        SELECT COUNT(DISTINCT 
          CASE 
            WHEN source = 'extension' THEN substring(claim_text FROM 1 FOR 8)
            ELSE source 
          END
        ) as unique_users
        FROM verification_requests 
        ${whereClause}
      `;
      
      const result = await this.pool.query(uniqueUsersQuery, params);
      return parseInt(result.rows[0]?.unique_users || '0');
      
    } catch (error) {
      this.logger.error('Failed to get unique users count:', error);
      throw error;
    }
  }

  async validateApiKey(apiKey: string): Promise<ApiKey | null> {
    try {
      const result = await this.pool.query(
        `SELECT ak.*, u.organization 
         FROM api_keys ak 
         JOIN users u ON ak.user_id = u.id 
         WHERE ak.key = $1 AND ak.is_active = true 
         AND (ak.expires_at IS NULL OR ak.expires_at > NOW())`,
        [apiKey]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      
      // Update last used timestamp
      await this.pool.query(
        'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
        [row.id]
      );
      
      return {
        id: row.id,
        key: row.key,
        userId: row.user_id,
        organization: row.organization,
        permissions: row.permissions,
        tier: row.tier,
        dailyQuota: row.daily_quota,
        monthlyQuota: row.monthly_quota,
        rateLimit: row.rate_limit,
        isActive: row.is_active,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at
      };
    } catch (error) {
      this.logger.error('Failed to validate API key:', error);
      throw error;
    }
  }

  async getApiKeyUsage(apiKeyId: string): Promise<{ daily: number; monthly: number }> {
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const thisMonth = now.toISOString().substring(0, 7);
      
      const result = await this.pool.query(
        `SELECT 
           COALESCE(SUM(CASE WHEN usage_date = $2 THEN daily_usage ELSE 0 END), 0) as daily_usage,
           COALESCE(SUM(CASE WHEN usage_month = $3 THEN monthly_usage ELSE 0 END), 0) as monthly_usage
         FROM api_key_usage 
         WHERE api_key_id = $1`,
        [apiKeyId, today, thisMonth]
      );
      
      return {
        daily: parseInt(result.rows[0]?.daily_usage || '0'),
        monthly: parseInt(result.rows[0]?.monthly_usage || '0')
      };
    } catch (error) {
      this.logger.error('Failed to get API key usage:', error);
      throw error;
    }
  }

  async incrementApiKeyUsage(apiKeyId: string): Promise<void> {
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const thisMonth = now.toISOString().substring(0, 7);
      
      await this.pool.query(
        `INSERT INTO api_key_usage (api_key_id, usage_date, usage_month, daily_usage, monthly_usage)
         VALUES ($1, $2, $3, 1, 1)
         ON CONFLICT (api_key_id, usage_date, usage_month)
         DO UPDATE SET 
           daily_usage = api_key_usage.daily_usage + 1,
           monthly_usage = api_key_usage.monthly_usage + 1`,
        [apiKeyId, today, thisMonth]
      );
    } catch (error) {
      this.logger.error('Failed to increment API key usage:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Create source_documents table
      await client.query(`
        CREATE TABLE IF NOT EXISTS source_documents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          cid TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          source_url TEXT,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      
      // Create document_chunks table with vector support
      await client.query(`
        CREATE TABLE IF NOT EXISTS document_chunks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id UUID NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
          chunk_index INTEGER NOT NULL,
          content TEXT NOT NULL,
          embedding vector(1536),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      
      // Create verification_requests table
      await client.query(`
        CREATE TABLE IF NOT EXISTS verification_requests (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          claim_text TEXT NOT NULL,
          confidence NUMERIC,
          status VARCHAR(16) CHECK (status IN ('VERIFIED', 'UNVERIFIED', 'UNKNOWN')),
          doc_ids UUID[],
          source VARCHAR(50),
          extension_version VARCHAR(20),
          processing_time_ms INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      
      // Create users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email VARCHAR(255) UNIQUE NOT NULL,
          organization VARCHAR(255) NOT NULL,
          tier VARCHAR(50) DEFAULT 'free',
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      
      // Create api_keys table
      await client.query(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          key VARCHAR(255) UNIQUE NOT NULL,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          permissions TEXT[] DEFAULT '{"read"}',
          tier VARCHAR(50) DEFAULT 'free',
          daily_quota INTEGER DEFAULT 1000,
          monthly_quota INTEGER DEFAULT 30000,
          rate_limit INTEGER DEFAULT 100,
          is_active BOOLEAN DEFAULT true,
          expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          last_used_at TIMESTAMPTZ
        )
      `);
      
      // Create api_key_usage table
      await client.query(`
        CREATE TABLE IF NOT EXISTS api_key_usage (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
          usage_date DATE NOT NULL,
          usage_month VARCHAR(7) NOT NULL,
          daily_usage INTEGER DEFAULT 0,
          monthly_usage INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(api_key_id, usage_date, usage_month)
        )
      `);
      
      // Create indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding 
        ON document_chunks USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_verification_requests_created_at 
        ON verification_requests (created_at)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_verification_requests_status 
        ON verification_requests (status)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_api_keys_key 
        ON api_keys (key)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_api_keys_user_id 
        ON api_keys (user_id)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_api_key_usage_api_key_id 
        ON api_key_usage (api_key_id)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_api_key_usage_date 
        ON api_key_usage (usage_date)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_users_email 
        ON users (email)
      `);
      
      await client.query('COMMIT');
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
} 