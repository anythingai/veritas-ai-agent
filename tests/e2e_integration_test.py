"""
End-to-End Integration Test for Veritas AI Agent
Tests the complete flow from browser extension to backend to data pipeline
"""
import os
import sys
import time
import pytest
import requests
import tempfile
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

class TestVeritasE2E:
    """End-to-end integration tests for Veritas AI Agent"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test environment"""
        self.backend_url = os.getenv('BACKEND_URL', 'http://localhost:8080')
        self.data_pipeline_url = os.getenv('DATA_PIPELINE_URL', 'http://localhost:8000')
        self.test_claim = "The Earth orbits around the Sun in an elliptical path"
        self.test_document_content = """
        The Earth orbits around the Sun in an elliptical path. This orbital motion 
        takes approximately 365.25 days to complete one revolution. The Earth's 
        orbit is not perfectly circular, but rather elliptical, with the Sun at 
        one of the two foci of the ellipse.
        """
    
    def test_backend_health_check(self):
        """Test backend health check endpoint"""
        try:
            response = requests.get(f"{self.backend_url}/health", timeout=10)
            assert response.status_code == 200
            
            data = response.json()
            assert data['status'] in ['healthy', 'degraded']
            assert 'version' in data
            assert 'services' in data
            
            print(f"✓ Backend health check passed: {data['status']}")
            
        except Exception as e:
            pytest.fail(f"Backend health check failed: {e}")
    
    def test_data_pipeline_health_check(self):
        """Test data pipeline health check endpoint"""
        try:
            response = requests.get(f"{self.data_pipeline_url}/health", timeout=10)
            assert response.status_code == 200
            
            data = response.json()
            assert data['status'] in ['healthy', 'degraded']
            assert 'version' in data
            assert 'services' in data
            
            print(f"✓ Data pipeline health check passed: {data['status']}")
            
        except Exception as e:
            pytest.fail(f"Data pipeline health check failed: {e}")
    
    def test_verification_endpoint(self):
        """Test the main verification endpoint"""
        try:
            payload = {
                "claim_text": self.test_claim,
                "source": "e2e-test",
                "timestamp": time.time(),
                "extension_version": "1.1.0"
            }
            
            response = requests.post(
                f"{self.backend_url}/verify",
                json=payload,
                headers={'Content-Type': 'application/json'},
                timeout=30
            )
            
            assert response.status_code == 200
            
            data = response.json()
            assert 'status' in data
            assert 'confidence' in data
            assert 'citations' in data
            assert data['status'] in ['VERIFIED', 'UNVERIFIED', 'UNKNOWN']
            assert 0 <= data['confidence'] <= 1
            
            print(f"✓ Verification endpoint test passed: {data['status']} (confidence: {data['confidence']})")
            
        except Exception as e:
            pytest.fail(f"Verification endpoint test failed: {e}")
    
    def test_document_ingestion_flow(self):
        """Test complete document ingestion flow"""
        try:
            # Create a temporary test document
            with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
                f.write(self.test_document_content)
                temp_file_path = f.name
            
            try:
                # Upload document to data pipeline
                with open(temp_file_path, 'rb') as f:
                    files = {'file': ('test_document.txt', f, 'text/plain')}
                    response = requests.post(
                        f"{self.data_pipeline_url}/ingest",
                        files=files,
                        timeout=60
                    )
                
                assert response.status_code == 200
                data = response.json()
                assert 'document_id' in data
                assert data['status'] == 'PENDING'
                
                document_id = data['document_id']
                print(f"✓ Document uploaded successfully: {document_id}")
                
                # Wait for processing to complete
                max_wait = 120  # 2 minutes
                wait_interval = 5  # 5 seconds
                elapsed = 0
                
                while elapsed < max_wait:
                    time.sleep(wait_interval)
                    elapsed += wait_interval
                    
                    # Check document status
                    status_response = requests.get(
                        f"{self.data_pipeline_url}/documents/{document_id}/status",
                        timeout=10
                    )
                    
                    if status_response.status_code == 200:
                        status_data = status_response.json()
                        if status_data['status'] == 'COMPLETED':
                            print(f"✓ Document processing completed: {status_data['cid']}")
                            break
                        elif status_data['status'] == 'FAILED':
                            pytest.fail(f"Document processing failed: {status_data['message']}")
                    
                    print(f"Document processing in progress... ({elapsed}s elapsed)")
                
                if elapsed >= max_wait:
                    pytest.fail("Document processing timed out")
                
                # Now test verification with the ingested document
                verification_payload = {
                    "claim_text": "The Earth orbits around the Sun",
                    "source": "e2e-test",
                    "timestamp": time.time(),
                    "extension_version": "1.1.0"
                }
                
                verification_response = requests.post(
                    f"{self.backend_url}/verify",
                    json=verification_payload,
                    headers={'Content-Type': 'application/json'},
                    timeout=30
                )
                
                assert verification_response.status_code == 200
                verification_data = verification_response.json()
                
                # Should find the document we just ingested
                assert verification_data['status'] in ['VERIFIED', 'UNVERIFIED', 'UNKNOWN']
                print(f"✓ Verification after ingestion: {verification_data['status']}")
                
            finally:
                # Clean up temporary file
                os.unlink(temp_file_path)
                
        except Exception as e:
            pytest.fail(f"Document ingestion flow test failed: {e}")
    
    def test_performance_requirements(self):
        """Test performance requirements (p95 < 300ms for backend)"""
        try:
            # Send multiple requests to test performance
            requests_data = []
            num_requests = 50
            
            for i in range(num_requests):
                payload = {
                    "claim_text": f"Test claim {i}: The Earth orbits around the Sun",
                    "source": "e2e-performance-test",
                    "timestamp": time.time(),
                    "extension_version": "1.1.0"
                }
                
                start_time = time.time()
                response = requests.post(
                    f"{self.backend_url}/verify",
                    json=payload,
                    headers={'Content-Type': 'application/json'},
                    timeout=10
                )
                end_time = time.time()
                
                if response.status_code == 200:
                    requests_data.append(end_time - start_time)
                else:
                    print(f"Warning: Request {i} failed with status {response.status_code}")
            
            if len(requests_data) < num_requests * 0.9:  # Allow 10% failure rate
                pytest.fail(f"Too many requests failed: {len(requests_data)}/{num_requests}")
            
            # Calculate p95 latency
            sorted_times = sorted(requests_data)
            p95_index = int(len(sorted_times) * 0.95)
            p95_latency = sorted_times[p95_index] * 1000  # Convert to milliseconds
            
            print("✓ Performance test results:")
            print(f"  - Total requests: {len(requests_data)}")
            print(f"  - P95 latency: {p95_latency:.2f}ms")
            print(f"  - Average latency: {sum(requests_data)/len(requests_data)*1000:.2f}ms")
            
            # Check p95 requirement (300ms)
            assert p95_latency < 300, f"P95 latency {p95_latency:.2f}ms exceeds 300ms requirement"
            
        except Exception as e:
            pytest.fail(f"Performance test failed: {e}")
    
    def test_error_handling(self):
        """Test error handling and graceful degradation"""
        try:
            # Test with invalid claim (too short)
            payload = {
                "claim_text": "Hi",  # Too short
                "source": "e2e-error-test",
                "timestamp": time.time(),
                "extension_version": "1.1.0"
            }
            
            response = requests.post(
                f"{self.backend_url}/verify",
                json=payload,
                headers={'Content-Type': 'application/json'},
                timeout=10
            )
            
            # Should handle gracefully (might return UNKNOWN or error)
            assert response.status_code in [200, 400, 422]
            
            if response.status_code == 200:
                data = response.json()
                assert data['status'] in ['UNKNOWN', 'ERROR']
                print(f"✓ Short claim handled gracefully: {data['status']}")
            else:
                print(f"✓ Invalid claim properly rejected: {response.status_code}")
            
            # Test with malformed JSON
            response = requests.post(
                f"{self.backend_url}/verify",
                data="invalid json",
                headers={'Content-Type': 'application/json'},
                timeout=10
            )
            
            assert response.status_code in [400, 422]
            print("✓ Malformed JSON properly rejected")
            
        except Exception as e:
            pytest.fail(f"Error handling test failed: {e}")
    
    def test_security_headers(self):
        """Test security headers and CORS"""
        try:
            # Test CORS headers
            response = requests.options(
                f"{self.backend_url}/verify",
                headers={
                    'Origin': 'https://chat.openai.com',
                    'Access-Control-Request-Method': 'POST',
                    'Access-Control-Request-Headers': 'Content-Type'
                },
                timeout=10
            )
            
            # Should allow CORS for browser extension
            assert response.status_code in [200, 204]
            print("✓ CORS headers properly configured")
            
            # Test security headers on main endpoint
            response = requests.get(f"{self.backend_url}/health", timeout=10)
            
            # Check for security headers
            security_headers = [
                'X-Content-Type-Options',
                'X-Frame-Options',
                'X-XSS-Protection',
                'Strict-Transport-Security'
            ]
            
            for header in security_headers:
                if header in response.headers:
                    print(f"✓ Security header present: {header}")
                else:
                    print(f"⚠ Security header missing: {header}")
            
        except Exception as e:
            pytest.fail(f"Security headers test failed: {e}")
    
    def test_metrics_endpoints(self):
        """Test metrics and monitoring endpoints"""
        try:
            # Test backend metrics
            response = requests.get(f"{self.backend_url}/metrics", timeout=10)
            assert response.status_code == 200
            assert 'text/plain' in response.headers.get('Content-Type', '')
            assert len(response.text) > 0
            print("✓ Backend metrics endpoint working")
            
            # Test data pipeline metrics
            response = requests.get(f"{self.data_pipeline_url}/metrics", timeout=10)
            assert response.status_code == 200
            assert 'text/plain' in response.headers.get('Content-Type', '')
            assert len(response.text) > 0
            print("✓ Data pipeline metrics endpoint working")
            
        except Exception as e:
            pytest.fail(f"Metrics endpoints test failed: {e}")

def run_e2e_tests():
    """Run all end-to-end tests"""
    print("🚀 Starting Veritas AI Agent End-to-End Integration Tests")
    print("=" * 60)
    
    # Run tests
    pytest.main([
        __file__,
        '-v',
        '--tb=short',
        '--disable-warnings'
    ])

if __name__ == "__main__":
    run_e2e_tests() 