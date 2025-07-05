import { Logger } from 'winston';
import { create } from 'ipfs-http-client';

export class IPFSService {
  private ipfs: any;
  private gatewayUrls: string[];
  private currentGatewayIndex: number = 0;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1 second

  constructor(private logger: Logger) {
    // Multiple IPFS gateways for fallback
    this.gatewayUrls = [
      process.env.IPFS_GATEWAY_URL || 'https://ipfs.io',
      'https://gateway.pinata.cloud',
      'https://cloudflare-ipfs.com',
      'https://dweb.link',
      'https://ipfs.fleek.co'
    ];
    
    // Initialize IPFS client with primary API endpoint
    const ipfsUrl = process.env.IPFS_API_URL || 'https://ipfs.infura.io:5001/api/v0';
    this.ipfs = create({ url: ipfsUrl });
  }

  async initialize(): Promise<void> {
    try {
      // Test IPFS connection with fallback
      const testCid = await this.storeDocument('test');
      if (!testCid) {
        throw new Error('Failed to store test document');
      }
      
      this.logger.info('IPFS service initialized successfully with multi-gateway support');
    } catch (error) {
      this.logger.error('IPFS service initialization failed:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const testCid = await this.storeDocument('health check');
      return !!testCid;
    } catch (error) {
      this.logger.error('IPFS service health check failed:', error);
      return false;
    }
  }

  async storeDocument(content: string): Promise<string> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const result = await this.ipfs.add(content);
        return result.cid.toString();
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`IPFS store attempt ${attempt + 1} failed:`, error);
        
        if (attempt < this.maxRetries - 1) {
          await this.delay(this.retryDelay * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }
    
    this.logger.error('Failed to store document in IPFS after all retries:', lastError);
    throw lastError || new Error('IPFS store operation failed');
  }

  async retrieveDocument(cid: string): Promise<string> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const chunks = [];
        for await (const chunk of this.ipfs.cat(cid)) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString();
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`IPFS retrieve attempt ${attempt + 1} failed for CID ${cid}:`, error);
        
        if (attempt < this.maxRetries - 1) {
          await this.delay(this.retryDelay * Math.pow(2, attempt));
        }
      }
    }
    
    this.logger.error(`Failed to retrieve document ${cid} from IPFS after all retries:`, lastError);
    throw lastError || new Error(`IPFS retrieve operation failed for CID: ${cid}`);
  }

  getGatewayUrl(cid: string): string {
    return `${this.gatewayUrls[this.currentGatewayIndex]}/ipfs/${cid}`;
  }

  async getGatewayUrlWithFallback(cid: string): Promise<string> {
    // Try to find a working gateway
    for (let i = 0; i < this.gatewayUrls.length; i++) {
      const gatewayUrl = `${this.gatewayUrls[i]}/ipfs/${cid}`;
      
      try {
        const response = await fetch(gatewayUrl, { 
          method: 'HEAD',
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });
        
        if (response.ok) {
          this.currentGatewayIndex = i; // Update to working gateway
          return gatewayUrl;
        }
      } catch (error) {
        this.logger.debug(`Gateway ${this.gatewayUrls[i]} failed for CID ${cid}:`, error);
        continue;
      }
    }
    
    // If all gateways fail, return the primary gateway URL
    this.logger.warn(`All IPFS gateways failed for CID ${cid}, using primary gateway`);
    return `${this.gatewayUrls[0]}/ipfs/${cid}`;
  }

  async validateCID(cid: string): Promise<boolean> {
    try {
      // Try to retrieve a small portion of the document to validate CID
      const chunks = [];
      let chunkCount = 0;
      const maxChunks = 1; // Only check first chunk for validation
      
      for await (const chunk of this.ipfs.cat(cid)) {
        chunks.push(chunk);
        chunkCount++;
        if (chunkCount >= maxChunks) break;
      }
      
      return chunks.length > 0;
    } catch (error) {
      this.logger.error(`CID validation failed for ${cid}:`, error);
      return false;
    }
  }

  getGatewayStatus(): { currentGateway: string; availableGateways: string[] } {
    return {
      currentGateway: this.gatewayUrls[this.currentGatewayIndex] || this.gatewayUrls[0] || 'https://ipfs.io',
      availableGateways: this.gatewayUrls
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 