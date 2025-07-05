"""
IPFS Service for Veritas Data Pipeline
Handles document storage and retrieval with multi-gateway fallback
"""
import os
import asyncio
import aiohttp
import structlog
from typing import Optional, Dict, Any
from ipfshttpclient import connect, Client

logger = structlog.get_logger()

class IPFSService:
    """IPFS service with multi-gateway fallback support"""
    
    def __init__(self):
        # Multiple IPFS gateways for fallback
        self.gateway_urls = [
            os.getenv('IPFS_GATEWAY_URL', 'https://ipfs.io'),
            'https://gateway.pinata.cloud',
            'https://cloudflare-ipfs.com',
            'https://dweb.link',
            'https://ipfs.fleek.co'
        ]
        
        # IPFS API endpoints
        self.api_urls = [
            os.getenv('IPFS_API_URL', 'https://ipfs.infura.io:5001/api/v0'),
            'https://ipfs.io:5001/api/v0',
            'https://gateway.pinata.cloud:5001/api/v0'
        ]
        
        self.current_gateway_index = 0
        self.current_api_index = 0
        self.max_retries = 3
        self.retry_delay = 1.0  # 1 second
        self.client: Optional[Client] = None
        
    async def initialize(self) -> None:
        """Initialize IPFS client with fallback"""
        try:
            # Try to connect to IPFS API endpoints
            for i, api_url in enumerate(self.api_urls):
                try:
                    self.client = connect(api_url, session=True)
                    self.current_api_index = i
                    logger.info("IPFS client initialized", api_url=api_url)
                    break
                except Exception as e:
                    logger.warning("Failed to connect to IPFS API", api_url=api_url, error=str(e))
                    continue
            
            if not self.client:
                raise Exception("Failed to connect to any IPFS API endpoint")
            
            # Test connection
            test_cid = await self.store_document("test")
            if not test_cid:
                raise Exception("Failed to store test document")
                
            logger.info("IPFS service initialized successfully with multi-gateway support")
            
        except Exception as e:
            logger.error("IPFS service initialization failed", error=str(e))
            raise
    
    async def health_check(self) -> bool:
        """Check IPFS service health"""
        try:
            test_cid = await self.store_document("health check")
            return bool(test_cid)
        except Exception as e:
            logger.error("IPFS health check failed", error=str(e))
            return False
    
    async def store_document(self, content: str) -> str:
        """Store document in IPFS with retry logic"""
        if not self.client:
            raise Exception("IPFS client not initialized")
        
        last_error = None
        
        for attempt in range(self.max_retries):
            try:
                # Try current API endpoint
                result = self.client.add_str(content)
                return result
            except Exception as e:
                last_error = e
                logger.warning("IPFS store attempt failed", 
                             attempt=attempt + 1, 
                             api_url=self.api_urls[self.current_api_index],
                             error=str(e))
                
                if attempt < self.max_retries - 1:
                    # Try next API endpoint
                    self.current_api_index = (self.current_api_index + 1) % len(self.api_urls)
                    try:
                        self.client = connect(self.api_urls[self.current_api_index], session=True)
                        await asyncio.sleep(self.retry_delay * (2 ** attempt))  # Exponential backoff
                    except Exception as reconnect_error:
                        logger.warning("Failed to reconnect to IPFS API", 
                                     api_url=self.api_urls[self.current_api_index],
                                     error=str(reconnect_error))
                        continue
        
        logger.error("Failed to store document in IPFS after all retries", error=str(last_error))
        raise last_error or Exception("IPFS store operation failed")
    
    async def retrieve_document(self, cid: str) -> str:
        """Retrieve document from IPFS with retry logic"""
        if not self.client:
            raise Exception("IPFS client not initialized")
        
        last_error = None
        
        for attempt in range(self.max_retries):
            try:
                # Try current API endpoint
                result = self.client.cat(cid)
                return result.decode('utf-8')
            except Exception as e:
                last_error = e
                logger.warning("IPFS retrieve attempt failed", 
                             attempt=attempt + 1, 
                             cid=cid,
                             api_url=self.api_urls[self.current_api_index],
                             error=str(e))
                
                if attempt < self.max_retries - 1:
                    # Try next API endpoint
                    self.current_api_index = (self.current_api_index + 1) % len(self.api_urls)
                    try:
                        self.client = connect(self.api_urls[self.current_api_index], session=True)
                        await asyncio.sleep(self.retry_delay * (2 ** attempt))
                    except Exception as reconnect_error:
                        logger.warning("Failed to reconnect to IPFS API", 
                                     api_url=self.api_urls[self.current_api_index],
                                     error=str(reconnect_error))
                        continue
        
        logger.error("Failed to retrieve document from IPFS after all retries", 
                    cid=cid, error=str(last_error))
        raise last_error or Exception(f"IPFS retrieve operation failed for CID: {cid}")
    
    def get_gateway_url(self, cid: str) -> str:
        """Get gateway URL for CID"""
        return f"{self.gateway_urls[self.current_gateway_index]}/ipfs/{cid}"
    
    async def get_gateway_url_with_fallback(self, cid: str) -> str:
        """Get working gateway URL with fallback"""
        async with aiohttp.ClientSession() as session:
            for i, gateway_url in enumerate(self.gateway_urls):
                full_url = f"{gateway_url}/ipfs/{cid}"
                
                try:
                    async with session.head(full_url, timeout=aiohttp.ClientTimeout(total=5)) as response:
                        if response.status == 200:
                            self.current_gateway_index = i
                            return full_url
                except Exception as e:
                    logger.debug("Gateway failed", gateway=gateway_url, cid=cid, error=str(e))
                    continue
            
            # If all gateways fail, return primary gateway URL
            logger.warning("All IPFS gateways failed", cid=cid)
            return f"{self.gateway_urls[0]}/ipfs/{cid}"
    
    async def validate_cid(self, cid: str) -> bool:
        """Validate CID by attempting to retrieve a small portion"""
        try:
            if not self.client:
                return False
                
            # Try to retrieve first chunk
            result = self.client.cat(cid, length=100)  # Get first 100 bytes
            return len(result) > 0
        except Exception as e:
            logger.error("CID validation failed", cid=cid, error=str(e))
            return False
    
    def get_gateway_status(self) -> Dict[str, Any]:
        """Get current gateway status"""
        return {
            "current_gateway": self.gateway_urls[self.current_gateway_index],
            "current_api": self.api_urls[self.current_api_index],
            "available_gateways": self.gateway_urls,
            "available_apis": self.api_urls
        }
    
    async def close(self) -> None:
        """Close IPFS client connection"""
        if self.client:
            try:
                self.client.close()
                logger.info("IPFS client connection closed")
            except Exception as e:
                logger.warning("Error closing IPFS client", error=str(e)) 