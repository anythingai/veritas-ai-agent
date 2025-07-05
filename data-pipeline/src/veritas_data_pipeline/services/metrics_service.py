"""
Metrics Service for Veritas Data Pipeline
Handles monitoring and observability metrics
"""
import structlog
from typing import Dict, Any
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST

logger = structlog.get_logger()

class MetricsService:
    """Metrics service for monitoring and observability"""
    
    def __init__(self):
        # Prometheus metrics
        self.document_processing_total = Counter(
            'veritas_document_processing_total',
            'Total number of documents processed',
            ['status', 'mime_type']
        )
        
        self.document_processing_duration = Histogram(
            'veritas_document_processing_duration_seconds',
            'Time spent processing documents',
            ['mime_type']
        )
        
        self.embedding_generation_total = Counter(
            'veritas_embedding_generation_total',
            'Total number of embeddings generated',
            ['model']
        )
        
        self.embedding_generation_duration = Histogram(
            'veritas_embedding_generation_duration_seconds',
            'Time spent generating embeddings',
            ['model']
        )
        
        self.ipfs_operations_total = Counter(
            'veritas_ipfs_operations_total',
            'Total number of IPFS operations',
            ['operation', 'status']
        )
        
        self.ipfs_operation_duration = Histogram(
            'veritas_ipfs_operation_duration_seconds',
            'Time spent on IPFS operations',
            ['operation']
        )
        
        self.database_operations_total = Counter(
            'veritas_database_operations_total',
            'Total number of database operations',
            ['operation', 'status']
        )
        
        self.database_operation_duration = Histogram(
            'veritas_database_operation_duration_seconds',
            'Time spent on database operations',
            ['operation']
        )
        
        self.active_documents = Gauge(
            'veritas_active_documents',
            'Number of active documents in the system'
        )
        
        self.total_chunks = Gauge(
            'veritas_total_chunks',
            'Total number of document chunks'
        )
        
        self.verification_requests_total = Counter(
            'veritas_verification_requests_total',
            'Total number of verification requests',
            ['status', 'source']
        )
        
        self.verification_request_duration = Histogram(
            'veritas_verification_request_duration_seconds',
            'Time spent processing verification requests',
            ['status']
        )
    
    def record_document_processing(self, status: str, mime_type: str, duration: float) -> None:
        """Record document processing metrics"""
        try:
            self.document_processing_total.labels(status=status, mime_type=mime_type).inc()
            self.document_processing_duration.labels(mime_type=mime_type).observe(duration)
            
            logger.info("Document processing metrics recorded", 
                       status=status, mime_type=mime_type, duration=duration)
            
        except Exception as e:
            logger.error("Failed to record document processing metrics", error=str(e))
    
    def record_embedding_generation(self, model: str, duration: float) -> None:
        """Record embedding generation metrics"""
        try:
            self.embedding_generation_total.labels(model=model).inc()
            self.embedding_generation_duration.labels(model=model).observe(duration)
            
            logger.debug("Embedding generation metrics recorded", 
                        model=model, duration=duration)
            
        except Exception as e:
            logger.error("Failed to record embedding generation metrics", error=str(e))
    
    def record_ipfs_operation(self, operation: str, status: str, duration: float) -> None:
        """Record IPFS operation metrics"""
        try:
            self.ipfs_operations_total.labels(operation=operation, status=status).inc()
            self.ipfs_operation_duration.labels(operation=operation).observe(duration)
            
            logger.debug("IPFS operation metrics recorded", 
                        operation=operation, status=status, duration=duration)
            
        except Exception as e:
            logger.error("Failed to record IPFS operation metrics", error=str(e))
    
    def record_database_operation(self, operation: str, status: str, duration: float) -> None:
        """Record database operation metrics"""
        try:
            self.database_operations_total.labels(operation=operation, status=status).inc()
            self.database_operation_duration.labels(operation=operation).observe(duration)
            
            logger.debug("Database operation metrics recorded", 
                        operation=operation, status=status, duration=duration)
            
        except Exception as e:
            logger.error("Failed to record database operation metrics", error=str(e))
    
    def record_verification_request(self, status: str, source: str, duration: float) -> None:
        """Record verification request metrics"""
        try:
            self.verification_requests_total.labels(status=status, source=source).inc()
            self.verification_request_duration.labels(status=status).observe(duration)
            
            logger.info("Verification request metrics recorded", 
                       status=status, source=source, duration=duration)
            
        except Exception as e:
            logger.error("Failed to record verification request metrics", error=str(e))
    
    def update_document_counts(self, active_documents: int, total_chunks: int) -> None:
        """Update document count gauges"""
        try:
            self.active_documents.set(active_documents)
            self.total_chunks.set(total_chunks)
            
            logger.debug("Document counts updated", 
                        active_documents=active_documents, total_chunks=total_chunks)
            
        except Exception as e:
            logger.error("Failed to update document counts", error=str(e))
    
    def get_metrics(self) -> str:
        """Get Prometheus metrics in text format"""
        try:
            return generate_latest()
        except Exception as e:
            logger.error("Failed to generate metrics", error=str(e))
            return ""
    
    def get_metrics_content_type(self) -> str:
        """Get content type for metrics endpoint"""
        return CONTENT_TYPE_LATEST
    
    def get_business_metrics(self) -> Dict[str, Any]:
        """Get business metrics summary"""
        try:
            # This would typically query the database for business metrics
            # For now, return a placeholder structure
            return {
                'total_documents_processed': 0,
                'total_verifications': 0,
                'average_processing_time': 0.0,
                'success_rate': 0.0,
                'popular_mime_types': [],
                'verification_status_distribution': {
                    'verified': 0,
                    'unverified': 0,
                    'unknown': 0
                }
            }
        except Exception as e:
            logger.error("Failed to get business metrics", error=str(e))
            return {}
    
    def record_error(self, error_type: str, error_message: str) -> None:
        """Record error metrics"""
        try:
            # Create error counter if it doesn't exist
            if not hasattr(self, 'error_counter'):
                from prometheus_client import Counter
                self.error_counter = Counter(
                    'veritas_errors_total',
                    'Total number of errors',
                    ['error_type']
                )
            
            self.error_counter.labels(error_type=error_type).inc()
            
            logger.error("Error metrics recorded", 
                        error_type=error_type, error_message=error_message)
            
        except Exception as e:
            logger.error("Failed to record error metrics", error=str(e))
    
    def record_performance_metric(self, metric_name: str, value: float, labels: Dict[str, str] = None) -> None:
        """Record custom performance metric"""
        try:
            # Create custom histogram if it doesn't exist
            if not hasattr(self, 'custom_metrics'):
                self.custom_metrics = {}
            
            if metric_name not in self.custom_metrics:
                from prometheus_client import Histogram
                self.custom_metrics[metric_name] = Histogram(
                    f'veritas_{metric_name}',
                    f'Custom metric: {metric_name}',
                    list(labels.keys()) if labels else []
                )
            
            if labels:
                self.custom_metrics[metric_name].labels(**labels).observe(value)
            else:
                self.custom_metrics[metric_name].observe(value)
            
            logger.debug("Custom performance metric recorded", 
                        metric_name=metric_name, value=value, labels=labels)
            
        except Exception as e:
            logger.error("Failed to record custom performance metric", error=str(e)) 