"""
Background Tasks for Veritas Data Pipeline
Handles asynchronous document processing using Celery
"""
import os
import time
import structlog
from celery import Celery
from celery.schedules import crontab
from typing import Dict, Any

logger = structlog.get_logger()

# Initialize Celery
celery_app = Celery('veritas_data_pipeline')

# Configure Celery
celery_app.conf.update(
    broker_url=os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0'),
    result_backend=os.getenv('CELERY_RESULT_BACKEND', 'redis://localhost:6379/0'),
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_track_started=True,
    task_time_limit=30 * 60,  # 30 minutes
    task_soft_time_limit=25 * 60,  # 25 minutes
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=1000,
)

@celery_app.task(bind=True, name='veritas.process_document')
async def process_document_task(self, document_id: str, filename: str) -> Dict[str, Any]:
    """Process document in background"""
    start_time = time.time()
    
    try:
        logger.info("Starting document processing", 
                   task_id=self.request.id,
                   document_id=document_id,
                   filename=filename)
        
        # Import services here to avoid circular imports
        from .services.document_processor import DocumentProcessor
        from .services.embedding_service import EmbeddingService
        from .services.ipfs_service import IPFSService
        from .services.database_service import DatabaseService
        from .services.metrics_service import MetricsService
        
        # Initialize services
        document_processor = DocumentProcessor()
        embedding_service = EmbeddingService()
        ipfs_service = IPFSService()
        database_service = DatabaseService()
        metrics_service = MetricsService()
        
        # Update task status
        self.update_state(
            state='PROGRESS',
            meta={'current': 10, 'total': 100, 'status': 'Initializing services'}
        )
        
        # Initialize services
        await embedding_service.initialize()
        await ipfs_service.initialize()
        await database_service.initialize()
        
        self.update_state(
            state='PROGRESS',
            meta={'current': 20, 'total': 100, 'status': 'Services initialized'}
        )
        
        # Process document (this would typically read from a file path)
        # For now, we'll simulate document processing
        mime_type = 'text/plain'  # Default
        content = f"Simulated content for document {document_id}"
        
        # Update task status
        self.update_state(
            state='PROGRESS',
            meta={'current': 40, 'total': 100, 'status': 'Document processed'}
        )
        
        # Generate embeddings for chunks
        chunks = document_processor._chunk_content(content)
        chunk_embeddings = []
        
        for i, chunk in enumerate(chunks):
            embedding = await embedding_service.embed_text(chunk)
            chunk_embeddings.append(embedding)
            
            # Update progress
            progress = 40 + (i + 1) * 30 // len(chunks)
            self.update_state(
                state='PROGRESS',
                meta={'current': progress, 'total': 100, 'status': f'Generated embedding {i+1}/{len(chunks)}'}
            )
        
        # Store in IPFS
        cid = await ipfs_service.store_document(content)
        
        self.update_state(
            state='PROGRESS',
            meta={'current': 80, 'total': 100, 'status': 'Stored in IPFS'}
        )
        
        # Store in database
        document_data = {
            'cid': cid,
            'title': filename,
            'mime_type': mime_type,
            'content': content,
            'chunks': chunks,
            'chunk_embeddings': chunk_embeddings
        }
        
        stored_document_id = await database_service.store_document(document_data)
        
        # Record metrics
        processing_time = time.time() - start_time
        metrics_service.record_document_processing('SUCCESS', mime_type, processing_time)
        metrics_service.record_embedding_generation(
            embedding_service.model_name if not embedding_service.use_openai else 'openai',
            processing_time
        )
        
        # Update document status in database
        await database_service.update_document_status(document_id, 'COMPLETED', cid)
        
        logger.info("Document processing completed", 
                   task_id=self.request.id,
                   document_id=document_id,
                   cid=cid,
                   processing_time=processing_time)
        
        return {
            'status': 'SUCCESS',
            'document_id': stored_document_id,
            'cid': cid,
            'processing_time': processing_time,
            'chunks_count': len(chunks)
        }
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error("Document processing failed", 
                    task_id=self.request.id,
                    document_id=document_id,
                    error=str(e),
                    processing_time=processing_time)
        
        # Record error metrics
        try:
            metrics_service.record_document_processing('FAILED', 'unknown', processing_time)
            metrics_service.record_error('document_processing', str(e))
        except Exception:
            pass
        
        # Update document status
        try:
            await database_service.update_document_status(document_id, 'FAILED')
        except Exception:
            pass
        
        raise

@celery_app.task(bind=True, name='veritas.reembed_documents')
async def reembed_documents_task(self, document_ids: list = None) -> Dict[str, Any]:
    """Re-embed documents for knowledge base drift mitigation"""
    start_time = time.time()
    
    try:
        logger.info("Starting document re-embedding", 
                   task_id=self.request.id,
                   document_count=len(document_ids) if document_ids else 'all')
        
        # Import services
        from .services.embedding_service import EmbeddingService
        from .services.database_service import DatabaseService
        
        # Initialize services
        embedding_service = EmbeddingService()
        database_service = DatabaseService()
        
        await embedding_service.initialize()
        await database_service.initialize()
        
        # Get documents to re-embed
        if document_ids:
            documents = await database_service.get_documents_by_ids(document_ids)
        else:
            # Get all documents (paginated)
            documents = []
            page = 1
            while True:
                result = await database_service.get_documents(page=page, limit=100)
                if not result['documents']:
                    break
                documents.extend(result['documents'])
                page += 1
        
        total_documents = len(documents)
        processed_count = 0
        failed_count = 0
        
        for i, document in enumerate(documents):
            try:
                # Get document chunks
                chunks = await database_service.get_document_chunks(document['id'])
                
                # Re-generate embeddings
                new_embeddings = []
                for chunk in chunks:
                    embedding = await embedding_service.embed_text(chunk['content'])
                    new_embeddings.append(embedding)
                
                # Update embeddings in database
                await database_service.update_document_embeddings(document['id'], new_embeddings)
                
                processed_count += 1
                
                # Update progress
                progress = (i + 1) * 100 // total_documents
                self.update_state(
                    state='PROGRESS',
                    meta={
                        'current': progress,
                        'total': 100,
                        'status': f'Re-embedded {i+1}/{total_documents} documents'
                    }
                )
                
            except Exception as e:
                failed_count += 1
                logger.error("Failed to re-embed document", 
                           document_id=document['id'], error=str(e))
        
        processing_time = time.time() - start_time
        
        logger.info("Document re-embedding completed", 
                   task_id=self.request.id,
                   total_documents=total_documents,
                   processed_count=processed_count,
                   failed_count=failed_count,
                   processing_time=processing_time)
        
        return {
            'status': 'SUCCESS',
            'total_documents': total_documents,
            'processed_count': processed_count,
            'failed_count': failed_count,
            'processing_time': processing_time
        }
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error("Document re-embedding failed", 
                    task_id=self.request.id,
                    error=str(e),
                    processing_time=processing_time)
        raise

@celery_app.task(bind=True, name='veritas.cleanup_old_documents')
async def cleanup_old_documents_task(self, days_old: int = 30) -> Dict[str, Any]:
    """Clean up old documents and their embeddings"""
    start_time = time.time()
    
    try:
        logger.info("Starting document cleanup", 
                   task_id=self.request.id,
                   days_old=days_old)
        
        # Import services
        from .services.database_service import DatabaseService
        from .services.ipfs_service import IPFSService
        
        # Initialize services
        database_service = DatabaseService()
        ipfs_service = IPFSService()
        
        await database_service.initialize()
        await ipfs_service.initialize()
        
        # Get old documents
        old_documents = await database_service.get_old_documents(days_old)
        
        deleted_count = 0
        failed_count = 0
        
        for i, document in enumerate(old_documents):
            try:
                # Delete from IPFS (unpin)
                await ipfs_service.unpin_document(document['cid'])
                
                # Delete from database
                await database_service.delete_document(document['id'])
                
                deleted_count += 1
                
                # Update progress
                progress = (i + 1) * 100 // len(old_documents)
                self.update_state(
                    state='PROGRESS',
                    meta={
                        'current': progress,
                        'total': 100,
                        'status': f'Cleaned up {i+1}/{len(old_documents)} documents'
                    }
                )
                
            except Exception as e:
                failed_count += 1
                logger.error("Failed to cleanup document", 
                           document_id=document['id'], error=str(e))
        
        processing_time = time.time() - start_time
        
        logger.info("Document cleanup completed", 
                   task_id=self.request.id,
                   total_documents=len(old_documents),
                   deleted_count=deleted_count,
                   failed_count=failed_count,
                   processing_time=processing_time)
        
        return {
            'status': 'SUCCESS',
            'total_documents': len(old_documents),
            'deleted_count': deleted_count,
            'failed_count': failed_count,
            'processing_time': processing_time
        }
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error("Document cleanup failed", 
                    task_id=self.request.id,
                    error=str(e),
                    processing_time=processing_time)
        raise

# Configure periodic tasks
@celery_app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):
    """Setup periodic tasks"""
    # Re-embed documents nightly at 2 AM UTC
    sender.add_periodic_task(
        crontab(hour=2, minute=0),
        reembed_documents_task.s(),
        name='nightly-reembed-documents'
    )
    
    # Cleanup old documents weekly on Sunday at 3 AM UTC
    sender.add_periodic_task(
        crontab(day_of_week=0, hour=3, minute=0),
        cleanup_old_documents_task.s(days_old=30),
        name='weekly-cleanup-old-documents'
    ) 