import pytest
from fastapi.testclient import TestClient
from unittest.mock import Mock, patch, AsyncMock
from io import BytesIO

from veritas_data_pipeline.main import app

@pytest.fixture
def client():
    """Create a test client for the FastAPI app"""
    return TestClient(app)

@pytest.fixture
def mock_services():
    """Mock all services for testing"""
    with patch('veritas_data_pipeline.main.document_processor') as mock_dp, \
         patch('veritas_data_pipeline.main.embedding_service') as mock_es, \
         patch('veritas_data_pipeline.main.ipfs_service') as mock_is, \
         patch('veritas_data_pipeline.main.database_service') as mock_ds:
        
        # Setup mock services
        mock_dp.health_check = AsyncMock(return_value=True)
        mock_es.health_check = AsyncMock(return_value=True)
        mock_is.health_check = AsyncMock(return_value=True)
        mock_ds.health_check = AsyncMock(return_value=True)
        mock_ds.generate_document_id = Mock(return_value="doc-test-123")
        mock_ds.create_document_record = AsyncMock()
        
        yield {
            'document_processor': mock_dp,
            'embedding_service': mock_es,
            'ipfs_service': mock_is,
            'database_service': mock_ds
        }

class TestHealthCheck:
    """Test health check endpoint"""
    
    def test_health_check_success(self, client, mock_services):
        """Test successful health check"""
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["version"] == "1.1.0"
        assert "services" in data
        assert all(data["services"].values())
    
    def test_health_check_degraded(self, client, mock_services):
        """Test degraded health check when some services are unhealthy"""
        mock_services['database_service'].health_check = AsyncMock(return_value=False)
        
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"
        assert data["services"]["database"] == "unhealthy"
    
    def test_health_check_failure(self, client, mock_services):
        """Test health check failure"""
        mock_services['database_service'].health_check = AsyncMock(
            side_effect=Exception("Database connection failed")
        )
        
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "unhealthy"
        assert "error" in data

class TestDocumentIngestion:
    """Test document ingestion endpoints"""
    
    def test_ingest_single_document_success(self, client, mock_services):
        """Test successful single document ingestion"""
        # Create a mock file
        file_content = b"This is a test document content"
        files = {"file": ("test.txt", BytesIO(file_content), "text/plain")}
        
        response = client.post("/ingest", files=files)
        
        assert response.status_code == 200
        data = response.json()
        assert data["document_id"] == "doc-test-123"
        assert data["status"] == "PENDING"
        assert data["message"] == "Document accepted for processing"
        
        # Verify service calls
        mock_services['database_service'].create_document_record.assert_called_once()
    
    def test_ingest_document_no_file(self, client):
        """Test ingestion without file"""
        response = client.post("/ingest")
        
        assert response.status_code == 422  # Validation error
    
    def test_ingest_document_too_large(self, client):
        """Test ingestion of file that's too large"""
        # Create a large file (simulate > 50MB)
        large_content = b"x" * (51 * 1024 * 1024)  # 51MB
        files = {"file": ("large.txt", BytesIO(large_content), "text/plain")}
        
        response = client.post("/ingest", files=files)
        
        assert response.status_code == 400
        data = response.json()
        assert "too large" in data["detail"].lower()
    
    def test_ingest_batch_documents_success(self, client, mock_services):
        """Test successful batch document ingestion"""
        # Create multiple mock files
        files = [
            ("files", ("doc1.txt", BytesIO(b"Document 1"), "text/plain")),
            ("files", ("doc2.txt", BytesIO(b"Document 2"), "text/plain")),
            ("files", ("doc3.txt", BytesIO(b"Document 3"), "text/plain"))
        ]
        
        response = client.post("/ingest/batch", files=files)
        
        assert response.status_code == 200
        data = response.json()
        assert data["total_files"] == 3
        assert data["accepted_files"] == 3
        assert data["rejected_files"] == 0
    
    def test_ingest_batch_too_many_files(self, client):
        """Test batch ingestion with too many files"""
        # Create more than 100 files
        files = []
        for i in range(101):
            files.append(("files", (f"doc{i}.txt", BytesIO(b"content"), "text/plain")))
        
        response = client.post("/ingest/batch", files=files)
        
        assert response.status_code == 400
        data = response.json()
        assert "too many files" in data["detail"].lower()

class TestDocumentStatus:
    """Test document status endpoints"""
    
    def test_get_document_status_success(self, client, mock_services):
        """Test successful document status retrieval"""
        mock_services['database_service'].get_document_status = AsyncMock(
            return_value={
                "document_id": "doc-test-123",
                "status": "COMPLETE",
                "progress": 100.0,
                "message": "Document processed successfully",
                "cid": "QmTestCID123"
            }
        )
        
        response = client.get("/documents/doc-test-123/status")
        
        assert response.status_code == 200
        data = response.json()
        assert data["document_id"] == "doc-test-123"
        assert data["status"] == "COMPLETE"
        assert data["progress"] == 100.0
        assert data["cid"] == "QmTestCID123"
    
    def test_get_document_status_not_found(self, client, mock_services):
        """Test document status for non-existent document"""
        mock_services['database_service'].get_document_status = AsyncMock(
            side_effect=Exception("Document not found")
        )
        
        response = client.get("/documents/non-existent/status")
        
        assert response.status_code == 500
    
    def test_list_documents_success(self, client, mock_services):
        """Test successful document listing"""
        mock_services['database_service'].list_documents = AsyncMock(
            return_value={
                "documents": [
                    {
                        "id": "doc-1",
                        "title": "Document 1",
                        "status": "COMPLETE",
                        "created_at": "2024-01-01T00:00:00Z"
                    },
                    {
                        "id": "doc-2",
                        "title": "Document 2",
                        "status": "PENDING",
                        "created_at": "2024-01-02T00:00:00Z"
                    }
                ],
                "total": 2,
                "page": 1,
                "limit": 20
            }
        )
        
        response = client.get("/documents?page=1&limit=20")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["documents"]) == 2
        assert data["total"] == 2
        assert data["page"] == 1
    
    def test_list_documents_with_status_filter(self, client, mock_services):
        """Test document listing with status filter"""
        mock_services['database_service'].list_documents = AsyncMock(
            return_value={
                "documents": [
                    {
                        "id": "doc-1",
                        "title": "Document 1",
                        "status": "COMPLETE",
                        "created_at": "2024-01-01T00:00:00Z"
                    }
                ],
                "total": 1,
                "page": 1,
                "limit": 20
            }
        )
        
        response = client.get("/documents?status=COMPLETE")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["documents"]) == 1
        assert data["documents"][0]["status"] == "COMPLETE"

class TestMetrics:
    """Test metrics endpoint"""
    
    def test_get_metrics_success(self, client, mock_services):
        """Test successful metrics retrieval"""
        mock_services['database_service'].get_metrics = AsyncMock(
            return_value={
                "total_documents": 100,
                "documents_processed": 95,
                "documents_failed": 5,
                "average_processing_time": 2.5,
                "documents_by_status": {
                    "PENDING": 10,
                    "PROCESSING": 5,
                    "COMPLETE": 80,
                    "FAILED": 5
                }
            }
        )
        
        response = client.get("/metrics")
        
        assert response.status_code == 200
        data = response.json()
        assert data["total_documents"] == 100
        assert data["documents_processed"] == 95
        assert "documents_by_status" in data

class TestDocumentDeletion:
    """Test document deletion endpoint"""
    
    def test_delete_document_success(self, client, mock_services):
        """Test successful document deletion"""
        mock_services['database_service'].delete_document = AsyncMock()
        mock_services['ipfs_service'].remove_document = AsyncMock()
        
        response = client.delete("/documents/doc-test-123")
        
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Document deleted successfully"
        
        # Verify service calls
        mock_services['database_service'].delete_document.assert_called_once_with("doc-test-123")
        mock_services['ipfs_service'].remove_document.assert_called_once()
    
    def test_delete_document_not_found(self, client, mock_services):
        """Test deletion of non-existent document"""
        mock_services['database_service'].delete_document = AsyncMock(
            side_effect=Exception("Document not found")
        )
        
        response = client.delete("/documents/non-existent")
        
        assert response.status_code == 500

class TestErrorHandling:
    """Test error handling scenarios"""
    
    def test_database_connection_error(self, client, mock_services):
        """Test handling of database connection errors"""
        mock_services['database_service'].create_document_record = AsyncMock(
            side_effect=Exception("Database connection failed")
        )
        
        file_content = b"Test document"
        files = {"file": ("test.txt", BytesIO(file_content), "text/plain")}
        
        response = client.post("/ingest", files=files)
        
        assert response.status_code == 500
        data = response.json()
        assert "error" in data
    
    def test_ipfs_service_error(self, client, mock_services):
        """Test handling of IPFS service errors"""
        mock_services['ipfs_service'].health_check = AsyncMock(
            side_effect=Exception("IPFS service unavailable")
        )
        
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"
        assert data["services"]["ipfs"] == "unhealthy"
    
    def test_embedding_service_error(self, client, mock_services):
        """Test handling of embedding service errors"""
        mock_services['embedding_service'].health_check = AsyncMock(
            side_effect=Exception("Embedding service unavailable")
        )
        
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"
        assert data["services"]["embedding"] == "unhealthy"

class TestValidation:
    """Test input validation"""
    
    def test_invalid_file_type(self, client):
        """Test rejection of invalid file types"""
        file_content = b"Invalid file content"
        files = {"file": ("test.exe", BytesIO(file_content), "application/x-executable")}
        
        response = client.post("/ingest", files=files)
        
        assert response.status_code == 400
        data = response.json()
        assert "file type" in data["detail"].lower()
    
    def test_empty_file(self, client):
        """Test rejection of empty files"""
        files = {"file": ("empty.txt", BytesIO(b""), "text/plain")}
        
        response = client.post("/ingest", files=files)
        
        assert response.status_code == 400
        data = response.json()
        assert "empty" in data["detail"].lower()
    
    def test_invalid_pagination_parameters(self, client):
        """Test validation of pagination parameters"""
        response = client.get("/documents?page=0&limit=0")
        
        assert response.status_code == 422  # Validation error

class TestPerformance:
    """Test performance scenarios"""
    
    def test_concurrent_document_ingestion(self, client, mock_services):
        """Test handling of concurrent document ingestion"""
        import concurrent.futures
        
        def ingest_document():
            file_content = b"Concurrent test document"
            files = {"file": (f"test_{id}.txt", BytesIO(file_content), "text/plain")}
            return client.post("/ingest", files=files)
        
        # Submit multiple concurrent requests
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(ingest_document) for _ in range(5)]
            responses = [future.result() for future in futures]
        
        # All requests should succeed
        assert all(response.status_code == 200 for response in responses)
        
        # Verify all documents were created
        assert mock_services['database_service'].create_document_record.call_count == 5
    
    def test_large_batch_processing(self, client, mock_services):
        """Test processing of large batches"""
        # Create 50 files (within limit)
        files = []
        for i in range(50):
            files.append(("files", (f"doc{i}.txt", BytesIO(f"Document {i}".encode()), "text/plain")))
        
        response = client.post("/ingest/batch", files=files)
        
        assert response.status_code == 200
        data = response.json()
        assert data["total_files"] == 50
        assert data["accepted_files"] == 50

class TestSecurity:
    """Test security measures"""
    
    def test_cors_headers(self, client):
        """Test CORS headers are properly set"""
        response = client.options("/health")
        
        assert "access-control-allow-origin" in response.headers
        assert "access-control-allow-methods" in response.headers
        assert "access-control-allow-headers" in response.headers
    
    def test_content_type_validation(self, client):
        """Test content type validation"""
        # Send request without proper content type
        response = client.post("/ingest", data={"file": "invalid"})
        
        assert response.status_code == 422  # Validation error
    
    def test_file_size_validation(self, client):
        """Test file size validation"""
        # Create a file that's exactly at the limit
        file_content = b"x" * (50 * 1024 * 1024)  # 50MB
        files = {"file": ("large.txt", BytesIO(file_content), "text/plain")}
        
        response = client.post("/ingest", files=files)
        
        # Should be accepted at the limit
        assert response.status_code == 200

if __name__ == "__main__":
    pytest.main([__file__]) 