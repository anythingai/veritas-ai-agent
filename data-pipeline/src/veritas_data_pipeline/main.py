"""
Main entry point for the Veritas Data Pipeline package.
"""
import os
from typing import List, Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field
import structlog
from dotenv import load_dotenv
from datetime import datetime, UTC

from .services.document_processor import DocumentProcessor
from .services.embedding_service import EmbeddingService
from .services.ipfs_service import IPFSService
from .services.database_service import DatabaseService
from .services.metrics_service import MetricsService
from .tasks import process_document_task

# Load environment variables
load_dotenv()

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()

# Initialize services (will be initialized in startup event)
document_processor = None
embedding_service = None
ipfs_service = None
database_service = None
metrics_service = None

# Pydantic models
class DocumentResponse(BaseModel):
    document_id: str
    status: str
    message: str
    cid: Optional[str] = None

class DocumentStatus(BaseModel):
    document_id: str
    status: str
    progress: float = Field(ge=0, le=100)
    message: str
    cid: Optional[str] = None

class BatchUploadResponse(BaseModel):
    batch_id: str
    total_files: int
    accepted_files: int
    rejected_files: int
    message: str

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI app"""
    # Startup
    global document_processor, embedding_service, ipfs_service, database_service, metrics_service
    
    try:
        # Initialize services
        document_processor = DocumentProcessor()
        embedding_service = EmbeddingService()
        ipfs_service = IPFSService()
        database_service = DatabaseService()
        metrics_service = MetricsService()
        
        await database_service.initialize()
        await embedding_service.initialize()
        await ipfs_service.initialize()
        logger.info("Data pipeline services initialized successfully")
    except Exception as e:
        logger.error("Failed to initialize services", error=str(e))
        raise
    
    yield
    
    # Shutdown
    try:
        await database_service.close()
        logger.info("Data pipeline shutdown complete")
    except Exception as e:
        logger.error("Error during shutdown", error=str(e))

# Create FastAPI app with lifespan
app = FastAPI(
    title="Veritas Data Pipeline",
    description="Document ingestion and processing pipeline for Veritas AI Agent",
    version="1.1.0",
    docs_url="/docs" if os.getenv("ENVIRONMENT") != "production" else None,
    redoc_url="/redoc" if os.getenv("ENVIRONMENT") != "production" else None,
    lifespan=lifespan
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=os.getenv("ALLOWED_HOSTS", "*").split(",")
)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Check all services
        services = {
            "database": await database_service.health_check(),
            "embedding": await embedding_service.health_check(),
            "ipfs": await ipfs_service.health_check()
        }
        
        healthy = all(services.values())
        
        return {
            "status": "healthy" if healthy else "degraded",
            "timestamp": datetime.now(UTC).isoformat(),
            "version": "1.1.0",
            "services": services
        }
    except Exception as e:
        logger.error("Health check failed", error=str(e))
        return {
            "status": "unhealthy",
            "timestamp": datetime.now(UTC).isoformat(),
            "error": str(e)
        }

@app.post("/ingest", response_model=DocumentResponse)
async def ingest_document(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None
):
    """Ingest a single document for processing"""
    try:
        # Validate file
        if not file.filename:
            raise HTTPException(status_code=400, detail="No file provided")
        
        if file.size and file.size > 50 * 1024 * 1024:  # 50MB limit
            raise HTTPException(status_code=400, detail="File too large (max 50MB)")
        
        # Generate document ID
        document_id = database_service.generate_document_id()
        
        # Store initial record
        await database_service.create_document_record(
            document_id=document_id,
            filename=file.filename,
            status="PENDING"
        )
        
        # Start background processing
        task = process_document_task.delay(document_id, file.filename)
        
        logger.info("Document ingestion started", 
                   document_id=document_id, 
                   filename=file.filename,
                   task_id=task.id)
        
        return DocumentResponse(
            document_id=document_id,
            status="PENDING",
            message="Document accepted for processing"
        )
        
    except Exception as e:
        logger.error("Document ingestion failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ingest/batch", response_model=BatchUploadResponse)
async def ingest_documents_batch(
    files: List[UploadFile] = File(...)
):
    """Ingest multiple documents for batch processing"""
    try:
        if len(files) > 100:  # Limit batch size
            raise HTTPException(status_code=400, detail="Too many files (max 100)")
        
        batch_id = database_service.generate_batch_id()
        accepted_files = 0
        rejected_files = 0
        
        for file in files:
            try:
                # Validate file
                if not file.filename:
                    rejected_files += 1
                    continue
                
                if file.size and file.size > 50 * 1024 * 1024:
                    rejected_files += 1
                    continue
                
                # Generate document ID
                document_id = database_service.generate_document_id()
                
                # Store initial record
                await database_service.create_document_record(
                    document_id=document_id,
                    filename=file.filename,
                    status="PENDING",
                    batch_id=batch_id
                )
                
                # Start background processing
                process_document_task.delay(document_id, file.filename)
                accepted_files += 1
                
            except Exception as e:
                logger.error("Failed to process file in batch", 
                           filename=file.filename, 
                           error=str(e))
                rejected_files += 1
        
        logger.info("Batch ingestion completed", 
                   batch_id=batch_id,
                   total_files=len(files),
                   accepted_files=accepted_files,
                   rejected_files=rejected_files)
        
        return BatchUploadResponse(
            batch_id=batch_id,
            total_files=len(files),
            accepted_files=accepted_files,
            rejected_files=rejected_files,
            message=f"Batch processing started. {accepted_files} files accepted, {rejected_files} rejected."
        )
        
    except Exception as e:
        logger.error("Batch ingestion failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/documents/{document_id}/status", response_model=DocumentStatus)
async def get_document_status(document_id: str):
    """Get the processing status of a document"""
    try:
        status = await database_service.get_document_status(document_id)
        if not status:
            raise HTTPException(status_code=404, detail="Document not found")
        
        return DocumentStatus(**status)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get document status", 
                    document_id=document_id, 
                    error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/documents")
async def list_documents(
    page: int = 1,
    limit: int = 20,
    status: Optional[str] = None
):
    """List documents with pagination and filtering"""
    try:
        documents = await database_service.list_documents(
            page=page,
            limit=limit,
            status=status
        )
        
        return documents
        
    except Exception as e:
        logger.error("Failed to list documents", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/metrics")
async def get_metrics():
    """Get processing metrics"""
    try:
        metrics = await metrics_service.get_metrics()
        return metrics
        
    except Exception as e:
        logger.error("Failed to get metrics", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    """Delete a document and its associated data"""
    try:
        success = await database_service.delete_document(document_id)
        if not success:
            raise HTTPException(status_code=404, detail="Document not found")
        
        logger.info("Document deleted", document_id=document_id)
        return {"message": "Document deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to delete document", 
                    document_id=document_id, 
                    error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=os.getenv("ENVIRONMENT") == "development"
    ) 