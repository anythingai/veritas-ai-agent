-- Veritas AI Agent Database Schema
-- PostgreSQL with pgvector extension for vector similarity search

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Create custom types
CREATE TYPE verification_status AS ENUM ('VERIFIED', 'UNVERIFIED', 'UNKNOWN', 'PENDING', 'ERROR');
CREATE TYPE document_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE user_role AS ENUM ('researcher', 'developer', 'admin');

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    role user_role DEFAULT 'researcher',
    api_key_hash VARCHAR(255) UNIQUE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Source documents table
CREATE TABLE source_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cid VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT,
    source_url TEXT,
    content_hash VARCHAR(64),
    status document_status DEFAULT 'PENDING',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Document chunks table with vector embeddings
CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536), -- OpenAI ada-002 embedding dimensions
    token_count INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(document_id, chunk_index)
);

-- Verification requests table
CREATE TABLE verification_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_text TEXT NOT NULL,
    confidence NUMERIC(3,2) CHECK (confidence >= 0 AND confidence <= 1),
    status verification_status NOT NULL,
    source VARCHAR(100) DEFAULT 'browser-extension',
    extension_version VARCHAR(50),
    processing_time_ms INTEGER,
    user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Citations table (many-to-many relationship between verifications and documents)
CREATE TABLE citations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    verification_id UUID NOT NULL REFERENCES verification_requests(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
    chunk_id UUID REFERENCES document_chunks(id) ON DELETE SET NULL,
    similarity_score NUMERIC(3,2) CHECK (similarity_score >= 0 AND similarity_score <= 1),
    snippet TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(verification_id, document_id)
);

-- Analytics table for aggregated metrics
CREATE TABLE analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    total_verifications INTEGER DEFAULT 0,
    verified_count INTEGER DEFAULT 0,
    unverified_count INTEGER DEFAULT 0,
    unknown_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    avg_confidence NUMERIC(3,2),
    avg_processing_time_ms INTEGER,
    unique_users INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(date)
);

-- API usage tracking
CREATE TABLE api_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    endpoint VARCHAR(100) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INTEGER NOT NULL,
    response_time_ms INTEGER,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- System configuration table
CREATE TABLE system_config (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_source_documents_cid ON source_documents(cid);
CREATE INDEX idx_source_documents_status ON source_documents(status);
CREATE INDEX idx_source_documents_created_at ON source_documents(created_at);

CREATE INDEX idx_document_chunks_document_id ON document_chunks(document_id);
CREATE INDEX idx_document_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_verification_requests_status ON verification_requests(status);
CREATE INDEX idx_verification_requests_created_at ON verification_requests(created_at);
CREATE INDEX idx_verification_requests_user_id ON verification_requests(user_id);
CREATE INDEX idx_verification_requests_source ON verification_requests(source);

CREATE INDEX idx_citations_verification_id ON citations(verification_id);
CREATE INDEX idx_citations_document_id ON citations(document_id);
CREATE INDEX idx_citations_similarity ON citations(similarity_score);

CREATE INDEX idx_analytics_date ON analytics(date);

CREATE INDEX idx_api_usage_user_id ON api_usage(user_id);
CREATE INDEX idx_api_usage_created_at ON api_usage(created_at);
CREATE INDEX idx_api_usage_endpoint ON api_usage(endpoint);

-- Create full-text search indexes
CREATE INDEX idx_source_documents_title_fts ON source_documents USING gin(to_tsvector('english', title));
CREATE INDEX idx_document_chunks_content_fts ON document_chunks USING gin(to_tsvector('english', content));

-- Create functions for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_source_documents_updated_at BEFORE UPDATE ON source_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_analytics_updated_at BEFORE UPDATE ON analytics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_config_updated_at BEFORE UPDATE ON system_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function for similarity search
CREATE OR REPLACE FUNCTION search_similar_documents(
    query_embedding vector(1536),
    similarity_threshold float DEFAULT 0.3,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    document_id UUID,
    content TEXT,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        dc.id,
        dc.document_id,
        dc.content,
        1 - (dc.embedding <=> query_embedding) as similarity
    FROM document_chunks dc
    WHERE dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) > similarity_threshold
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Create function for analytics aggregation
CREATE OR REPLACE FUNCTION aggregate_daily_analytics()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO analytics (
        date,
        total_verifications,
        verified_count,
        unverified_count,
        unknown_count,
        error_count,
        avg_confidence,
        avg_processing_time_ms,
        unique_users
    )
    SELECT 
        DATE(created_at) as date,
        COUNT(*) as total_verifications,
        COUNT(*) FILTER (WHERE status = 'VERIFIED') as verified_count,
        COUNT(*) FILTER (WHERE status = 'UNVERIFIED') as unverified_count,
        COUNT(*) FILTER (WHERE status = 'UNKNOWN') as unknown_count,
        COUNT(*) FILTER (WHERE status = 'ERROR') as error_count,
        AVG(confidence) as avg_confidence,
        AVG(processing_time_ms) as avg_processing_time_ms,
        COUNT(DISTINCT user_id) as unique_users
    FROM verification_requests
    WHERE DATE(created_at) = CURRENT_DATE - INTERVAL '1 day'
    GROUP BY DATE(created_at)
    ON CONFLICT (date) DO UPDATE SET
        total_verifications = EXCLUDED.total_verifications,
        verified_count = EXCLUDED.verified_count,
        unverified_count = EXCLUDED.unverified_count,
        unknown_count = EXCLUDED.unknown_count,
        error_count = EXCLUDED.error_count,
        avg_confidence = EXCLUDED.avg_confidence,
        avg_processing_time_ms = EXCLUDED.avg_processing_time_ms,
        unique_users = EXCLUDED.unique_users,
        updated_at = NOW();
END;
$$;

-- Insert default system configuration
INSERT INTO system_config (key, value, description) VALUES
('embedding_model', 'text-embedding-ada-002', 'Default embedding model for document processing'),
('chunk_size', '500', 'Default chunk size for document processing'),
('chunk_overlap', '20', 'Default chunk overlap for document processing'),
('confidence_threshold_verified', '0.8', 'Minimum confidence for verified status'),
('confidence_threshold_unverified', '0.5', 'Minimum confidence for unverified status'),
('max_citations_per_verification', '5', 'Maximum number of citations returned per verification'),
('cache_ttl_seconds', '300', 'Cache TTL in seconds'),
('rate_limit_requests_per_second', '50', 'Rate limit for API requests per second');

-- Create default admin user (password should be changed in production)
INSERT INTO users (email, name, role, api_key_hash) VALUES
('admin@veritas.ai', 'System Administrator', 'admin', 'default-admin-key-hash');

-- Create materialized view for frequently accessed analytics
CREATE MATERIALIZED VIEW verification_summary AS
SELECT 
    DATE_TRUNC('hour', created_at) as hour,
    status,
    COUNT(*) as count,
    AVG(confidence) as avg_confidence,
    AVG(processing_time_ms) as avg_processing_time
FROM verification_requests
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', created_at), status
ORDER BY hour DESC, status;

-- Create index on materialized view
CREATE INDEX idx_verification_summary_hour ON verification_summary(hour);

-- Grant necessary permissions (adjust as needed for your security requirements)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO veritas;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO veritas;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO veritas; 