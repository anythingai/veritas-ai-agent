import pytest
from unittest.mock import Mock, patch, AsyncMock
from fastapi.testclient import TestClient
from fastapi import FastAPI
from veritas_data_pipeline.main import app

# Create a test app without startup events
test_app = FastAPI()
test_app.router = app.router

@pytest.fixture
def client():
    """Create a test client with mocked services"""
    with patch('veritas_data_pipeline.main.database_service') as mock_db, \
         patch('veritas_data_pipeline.main.document_processor') as mock_dp, \
         patch('veritas_data_pipeline.main.embedding_service') as mock_es, \
         patch('veritas_data_pipeline.main.ipfs_service') as mock_is, \
         patch('veritas_data_pipeline.main.metrics_service') as mock_ms:
        
        # Setup mock services
        mock_db.generate_document_id = Mock(return_value="test-doc-123")
        mock_db.create_document_record = AsyncMock()
        mock_db.health_check = AsyncMock(return_value=True)
        
        mock_dp.health_check = AsyncMock(return_value=True)
        mock_es.health_check = AsyncMock(return_value=True)
        mock_is.health_check = AsyncMock(return_value=True)
        mock_ms.health_check = AsyncMock(return_value=True)
        
        yield TestClient(test_app)

def test_ingest_document_success(client):
    """Test successful document ingestion"""
    # Create a mock file for testing
    test_content = b"This is a test document content for verification."
    
    response = client.post(
        "/ingest",
        files={"file": ("test_document.txt", test_content, "text/plain")}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert "document_id" in data
    assert data["status"] == "PENDING"
    assert "message" in data

def test_ingest_document_no_file(client):
    """Test document ingestion without file"""
    response = client.post("/ingest")
    assert response.status_code == 422  # Validation error

def test_ingest_document_large_file(client):
    """Test document ingestion with file too large"""
    # Create a large file (over 50MB limit)
    large_content = b"x" * (51 * 1024 * 1024)  # 51MB
    
    response = client.post(
        "/ingest",
        files={"file": ("large_document.txt", large_content, "text/plain")}
    )
    
    assert response.status_code == 400
    assert "too large" in response.json()["detail"].lower()

def test_ingest_batch_documents(client):
    """Test batch document ingestion"""
    test_files = [
        ("document1.txt", b"Content 1", "text/plain"),
        ("document2.txt", b"Content 2", "text/plain"),
        ("document3.txt", b"Content 3", "text/plain")
    ]
    
    response = client.post(
        "/ingest/batch",
        files=[("files", file) for file in test_files]
    )
    
    assert response.status_code == 200
    data = response.json()
    assert "batch_id" in data
    assert data["total_files"] == 3
    assert data["accepted_files"] == 3 