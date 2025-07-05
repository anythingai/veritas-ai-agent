"""
Embedding Service for Veritas Data Pipeline
Handles text embedding generation for RAG pipeline
"""
import os
import asyncio
import numpy as np
import structlog
from typing import List, Dict, Any, Optional
from sentence_transformers import SentenceTransformer
import openai

logger = structlog.get_logger()

class EmbeddingService:
    """Embedding service for text vectorization"""
    
    def __init__(self):
        self.model_name = os.getenv('EMBEDDING_MODEL', 'all-MiniLM-L6-v2')
        self.model: Optional[SentenceTransformer] = None
        self.openai_client: Optional[openai.OpenAI] = None
        self.use_openai = os.getenv('USE_OPENAI_EMBEDDINGS', 'false').lower() == 'true'
        self.embedding_dimensions = 384  # Default for all-MiniLM-L6-v2
        
        if self.use_openai:
            openai.api_key = os.getenv('OPENAI_API_KEY')
            if not openai.api_key:
                raise ValueError("OPENAI_API_KEY required when USE_OPENAI_EMBEDDINGS is true")
            self.openai_client = openai.OpenAI()
            self.embedding_dimensions = 1536  # OpenAI text-embedding-ada-002
    
    async def initialize(self) -> None:
        """Initialize embedding model"""
        try:
            if self.use_openai:
                logger.info("Using OpenAI embeddings")
                # Test OpenAI connection
                test_embedding = await self.embed_text("test")
                if not test_embedding or len(test_embedding) == 0:
                    raise Exception("Failed to generate test embedding with OpenAI")
            else:
                logger.info("Loading local embedding model", model=self.model_name)
                self.model = SentenceTransformer(self.model_name)
                
                # Test local model
                test_embedding = await self.embed_text("test")
                if not test_embedding or len(test_embedding) == 0:
                    raise Exception("Failed to generate test embedding with local model")
            
            logger.info("Embedding service initialized successfully", 
                       model=self.model_name if not self.use_openai else "openai",
                       dimensions=self.embedding_dimensions)
            
        except Exception as e:
            logger.error("Embedding service initialization failed", error=str(e))
            raise
    
    async def health_check(self) -> bool:
        """Check embedding service health"""
        try:
            test_embedding = await self.embed_text("health check")
            return bool(test_embedding) and len(test_embedding) > 0
        except Exception as e:
            logger.error("Embedding health check failed", error=str(e))
            return False
    
    async def embed_text(self, text: str) -> List[float]:
        """Generate embedding for text"""
        try:
            if self.use_openai and self.openai_client:
                # Use OpenAI embeddings
                response = await asyncio.to_thread(
                    self.openai_client.embeddings.create,
                    model="text-embedding-ada-002",
                    input=text
                )
                return response.data[0].embedding
            elif self.model:
                # Use local model
                embedding = await asyncio.to_thread(self.model.encode, text)
                return embedding.tolist()
            else:
                raise Exception("No embedding model available")
                
        except Exception as e:
            logger.error("Failed to generate embedding", text_length=len(text), error=str(e))
            raise
    
    async def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for batch of texts"""
        try:
            if self.use_openai and self.openai_client:
                # Use OpenAI embeddings with batch processing
                response = await asyncio.to_thread(
                    self.openai_client.embeddings.create,
                    model="text-embedding-ada-002",
                    input=texts
                )
                return [data.embedding for data in response.data]
            elif self.model:
                # Use local model with batch processing
                embeddings = await asyncio.to_thread(self.model.encode, texts)
                return embeddings.tolist()
            else:
                raise Exception("No embedding model available")
                
        except Exception as e:
            logger.error("Failed to generate batch embeddings", 
                        batch_size=len(texts), error=str(e))
            raise
    
    async def rerank_documents(self, query: str, documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Re-rank documents based on query similarity"""
        try:
            if not documents:
                return []
            
            # Generate query embedding
            query_embedding = await self.embed_text(query)
            
            # Calculate similarities
            similarities = []
            for doc in documents:
                if 'embedding' in doc:
                    similarity = self.calculate_cosine_similarity(query_embedding, doc['embedding'])
                    similarities.append((similarity, doc))
                else:
                    # If no embedding available, use a default low similarity
                    similarities.append((0.0, doc))
            
            # Sort by similarity (descending)
            similarities.sort(key=lambda x: x[0], reverse=True)
            
            # Return re-ranked documents
            reranked_docs = []
            for similarity, doc in similarities:
                doc_copy = doc.copy()
                doc_copy['similarity'] = similarity
                reranked_docs.append(doc_copy)
            
            logger.info("Documents re-ranked", 
                       query_length=len(query),
                       documents_count=len(documents),
                       top_similarity=similarities[0][0] if similarities else 0.0)
            
            return reranked_docs
            
        except Exception as e:
            logger.error("Failed to re-rank documents", error=str(e))
            # Return original documents if re-ranking fails
            return documents
    
    def calculate_cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """Calculate cosine similarity between two vectors"""
        try:
            vec1_array = np.array(vec1)
            vec2_array = np.array(vec2)
            
            # Normalize vectors
            norm1 = np.linalg.norm(vec1_array)
            norm2 = np.linalg.norm(vec2_array)
            
            if norm1 == 0 or norm2 == 0:
                return 0.0
            
            # Calculate cosine similarity
            similarity = np.dot(vec1_array, vec2_array) / (norm1 * norm2)
            return float(similarity)
            
        except Exception as e:
            logger.error("Failed to calculate cosine similarity", error=str(e))
            return 0.0
    
    def get_embedding_dimensions(self) -> int:
        """Get embedding dimensions"""
        return self.embedding_dimensions
    
    def validate_embedding(self, embedding: List[float]) -> bool:
        """Validate embedding vector"""
        try:
            if not embedding or len(embedding) != self.embedding_dimensions:
                return False
            
            # Check for NaN or infinite values
            embedding_array = np.array(embedding)
            if np.any(np.isnan(embedding_array)) or np.any(np.isinf(embedding_array)):
                return False
            
            return True
            
        except Exception as e:
            logger.error("Embedding validation failed", error=str(e))
            return False 