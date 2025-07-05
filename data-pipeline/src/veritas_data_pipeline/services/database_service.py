"""
Database Service for Veritas Data Pipeline
Handles PostgreSQL operations and vector storage
"""
import os
import uuid
import structlog
from typing import List, Dict, Any, Optional
import asyncpg

logger = structlog.get_logger()

class DatabaseService:
    """Database service for PostgreSQL operations"""
    
    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None
        self.connection_string = os.getenv('DATABASE_URL')
        if not self.connection_string:
            raise ValueError("DATABASE_URL environment variable is required")
    
    async def initialize(self) -> None:
        """Initialize database connection pool"""
        try:
            self.pool = await asyncpg.create_pool(
                self.connection_string,
                min_size=5,
                max_size=20,
                command_timeout=60
            )
            
            # Test connection
            async with self.pool.acquire() as conn:
                await conn.execute('SELECT 1')
            
            # Ensure tables exist
            await self.create_tables()
            
            logger.info("Database service initialized successfully")
            
        except Exception as e:
            logger.error("Database service initialization failed", error=str(e))
            raise
    
    async def create_tables(self) -> None:
        """Create database tables if they don't exist"""
        try:
            async with self.pool.acquire() as conn:
                # Create source_documents table
                await conn.execute('''
                    CREATE TABLE IF NOT EXISTS source_documents (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        cid TEXT NOT NULL UNIQUE,
                        title TEXT NOT NULL,
                        mime_type TEXT NOT NULL,
                        source_url TEXT,
                        content TEXT,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW()
                    )
                ''')
                
                # Create document_chunks table
                await conn.execute('''
                    CREATE TABLE IF NOT EXISTS document_chunks (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        document_id UUID REFERENCES source_documents(id) ON DELETE CASCADE,
                        chunk_index INTEGER NOT NULL,
                        content TEXT NOT NULL,
                        embedding VECTOR(384),
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    )
                ''')
                
                # Create verification_requests table
                await conn.execute('''
                    CREATE TABLE IF NOT EXISTS verification_requests (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        claim_text TEXT NOT NULL,
                        confidence NUMERIC(3,2),
                        status TEXT NOT NULL,
                        doc_ids UUID[],
                        source TEXT,
                        extension_version TEXT,
                        processing_time_ms INTEGER,
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    )
                ''')
                
                # Create indexes
                await conn.execute('CREATE INDEX IF NOT EXISTS idx_source_documents_cid ON source_documents(cid)')
                await conn.execute('CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id)')
                await conn.execute('CREATE INDEX IF NOT EXISTS idx_verification_requests_created_at ON verification_requests(created_at)')
                
                # Enable vector extension if not already enabled
                await conn.execute('CREATE EXTENSION IF NOT EXISTS vector')
                
            logger.info("Database tables created successfully")
            
        except Exception as e:
            logger.error("Failed to create database tables", error=str(e))
            raise
    
    async def health_check(self) -> bool:
        """Check database health"""
        try:
            async with self.pool.acquire() as conn:
                await conn.execute('SELECT 1')
            return True
        except Exception as e:
            logger.error("Database health check failed", error=str(e))
            return False
    
    def generate_document_id(self) -> str:
        """Generate a unique document ID"""
        return str(uuid.uuid4())
    
    def generate_batch_id(self) -> str:
        """Generate a unique batch ID"""
        return str(uuid.uuid4())
    
    async def create_document_record(self, document_id: str, filename: str, status: str) -> None:
        """Create initial document record"""
        try:
            async with self.pool.acquire() as conn:
                await conn.execute('''
                    INSERT INTO source_documents (id, title, mime_type, status)
                    VALUES ($1, $2, $3, $4)
                ''', document_id, filename, 'application/octet-stream', status)
            
            logger.info("Document record created", document_id=document_id, filename=filename)
            
        except Exception as e:
            logger.error("Failed to create document record", 
                        document_id=document_id, error=str(e))
            raise
    
    async def store_document(self, document_data: Dict[str, Any]) -> str:
        """Store document and its chunks in database"""
        try:
            document_id = str(uuid.uuid4())
            
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    # Insert document
                    await conn.execute('''
                        INSERT INTO source_documents (id, cid, title, mime_type, source_url, content)
                        VALUES ($1, $2, $3, $4, $5, $6)
                    ''', document_id, document_data['cid'], document_data['title'],
                        document_data['mime_type'], document_data.get('source_url', ''),
                        document_data.get('content', ''))
                    
                    # Insert chunks with embeddings
                    chunks = document_data.get('chunks', [])
                    chunk_embeddings = document_data.get('chunk_embeddings', [])
                    
                    for i, (chunk, embedding) in enumerate(zip(chunks, chunk_embeddings)):
                        await conn.execute('''
                            INSERT INTO document_chunks (document_id, chunk_index, content, embedding)
                            VALUES ($1, $2, $3, $4)
                        ''', document_id, i, chunk, embedding)
            
            logger.info("Document stored successfully", 
                       document_id=document_id,
                       chunks_count=len(chunks))
            
            return document_id
            
        except Exception as e:
            logger.error("Failed to store document", error=str(e))
            raise
    
    async def search_similar_documents(self, embedding: List[float], 
                                     options: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        """Search for similar documents using vector similarity"""
        try:
            limit = options.get('limit', 10) if options else 10
            similarity_threshold = options.get('similarityThreshold', 0.3) if options else 0.3
            
            async with self.pool.acquire() as conn:
                # Convert embedding to PostgreSQL vector format
                embedding_vector = f"[{','.join(map(str, embedding))}]"
                
                # Search using cosine similarity
                rows = await conn.fetch('''
                    SELECT 
                        dc.document_id,
                        dc.content,
                        dc.chunk_index,
                        sd.title,
                        sd.cid,
                        1 - (dc.embedding <=> $1) as similarity
                    FROM document_chunks dc
                    JOIN source_documents sd ON dc.document_id = sd.id
                    WHERE 1 - (dc.embedding <=> $1) > $2
                    ORDER BY dc.embedding <=> $1
                    LIMIT $3
                ''', embedding_vector, similarity_threshold, limit)
                
                documents = []
                for row in rows:
                    documents.append({
                        'id': str(row['document_id']),
                        'content': row['content'],
                        'chunk_index': row['chunk_index'],
                        'title': row['title'],
                        'cid': row['cid'],
                        'similarity': float(row['similarity'])
                    })
                
                logger.info("Similar documents found", 
                           query_embedding_length=len(embedding),
                           documents_found=len(documents),
                           top_similarity=documents[0]['similarity'] if documents else 0.0)
                
                return documents
                
        except Exception as e:
            logger.error("Failed to search similar documents", error=str(e))
            return []
    
    async def store_verification_request(self, request_data: Dict[str, Any]) -> None:
        """Store verification request for analytics"""
        try:
            async with self.pool.acquire() as conn:
                await conn.execute('''
                    INSERT INTO verification_requests 
                    (id, claim_text, confidence, status, doc_ids, source, extension_version, processing_time_ms, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ''', request_data['id'], request_data['claim_text'], request_data['confidence'],
                    request_data['status'], request_data['doc_ids'], request_data.get('source'),
                    request_data.get('extension_version'), request_data.get('processing_time_ms'),
                    request_data.get('created_at'))
            
            logger.info("Verification request stored", request_id=request_data['id'])
            
        except Exception as e:
            logger.error("Failed to store verification request", error=str(e))
            # Don't raise error for analytics data
    
    async def get_documents(self, page: int = 1, limit: int = 20) -> Dict[str, Any]:
        """Get paginated list of documents"""
        try:
            offset = (page - 1) * limit
            
            async with self.pool.acquire() as conn:
                # Get total count
                total_count = await conn.fetchval('SELECT COUNT(*) FROM source_documents')
                
                # Get documents
                rows = await conn.fetch('''
                    SELECT id, cid, title, mime_type, source_url, created_at
                    FROM source_documents
                    ORDER BY created_at DESC
                    LIMIT $1 OFFSET $2
                ''', limit, offset)
                
                documents = []
                for row in rows:
                    documents.append({
                        'id': str(row['id']),
                        'cid': row['cid'],
                        'title': row['title'],
                        'mime_type': row['mime_type'],
                        'source_url': row['source_url'],
                        'created_at': row['created_at'].isoformat()
                    })
                
                return {
                    'documents': documents,
                    'total_count': total_count,
                    'page': page,
                    'limit': limit,
                    'total_pages': (total_count + limit - 1) // limit
                }
                
        except Exception as e:
            logger.error("Failed to get documents", error=str(e))
            return {'documents': [], 'total_count': 0, 'page': page, 'limit': limit, 'total_pages': 0}
    
    async def get_verification_analytics(self, start_date: str = None, 
                                       end_date: str = None, source: str = None) -> Dict[str, Any]:
        """Get verification analytics"""
        try:
            async with self.pool.acquire() as conn:
                # Build query conditions
                conditions = []
                params = []
                param_count = 0
                
                if start_date:
                    param_count += 1
                    conditions.append(f"created_at >= ${param_count}")
                    params.append(start_date)
                
                if end_date:
                    param_count += 1
                    conditions.append(f"created_at <= ${param_count}")
                    params.append(end_date)
                
                if source:
                    param_count += 1
                    conditions.append(f"source = ${param_count}")
                    params.append(source)
                
                where_clause = " AND ".join(conditions) if conditions else "1=1"
                
                # Get analytics
                analytics = await conn.fetchrow(f'''
                    SELECT 
                        COUNT(*) as total_requests,
                        AVG(confidence) as avg_confidence,
                        AVG(processing_time_ms) as avg_processing_time,
                        COUNT(CASE WHEN status = 'VERIFIED' THEN 1 END) as verified_count,
                        COUNT(CASE WHEN status = 'UNVERIFIED' THEN 1 END) as unverified_count,
                        COUNT(CASE WHEN status = 'UNKNOWN' THEN 1 END) as unknown_count
                    FROM verification_requests
                    WHERE {where_clause}
                ''', *params)
                
                return {
                    'total_requests': analytics['total_requests'],
                    'avg_confidence': float(analytics['avg_confidence']) if analytics['avg_confidence'] else 0.0,
                    'avg_processing_time': float(analytics['avg_processing_time']) if analytics['avg_processing_time'] else 0.0,
                    'verified_count': analytics['verified_count'],
                    'unverified_count': analytics['unverified_count'],
                    'unknown_count': analytics['unknown_count'],
                    'verification_rate': float(analytics['verified_count']) / float(analytics['total_requests']) if analytics['total_requests'] > 0 else 0.0
                }
                
        except Exception as e:
            logger.error("Failed to get verification analytics", error=str(e))
            return {}
    
    async def close(self) -> None:
        """Close database connection pool"""
        if self.pool:
            await self.pool.close()
            logger.info("Database connection pool closed") 