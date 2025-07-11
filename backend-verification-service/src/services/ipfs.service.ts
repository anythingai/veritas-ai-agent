import { Logger } from 'winston';
import { create } from 'ipfs-http-client';

interface IPFSConfig {
  apiUrl: string;
  gatewayUrl: string;
  timeout: number;
  retries: number;
  headers?: Record<string, string>;
}

interface IPFSGateway {
  url: string;
  timeout: number;
  priority: number; // Lower number = higher priority
}

export class IPFSService {
  private ipfs: any;
  private gateways: IPFSGateway[];
  private currentGatewayIndex: number = 0;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1 second
  private config: IPFSConfig;

  constructor(private logger: Logger) {
    // Initialize configuration
    this.config = {
      apiUrl: process.env.IPFS_API_URL || 'https://ipfs.infura.io:5001/api/v0',
      gatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://ipfs.io',
      timeout: parseInt(process.env.IPFS_TIMEOUT || '30000'), // 30 seconds
      retries: parseInt(process.env.IPFS_RETRIES || '3')
    };

    // Multiple IPFS gateways for fallback (ordered by priority)
    this.gateways = [
      { url: this.config.gatewayUrl, timeout: 5000, priority: 1 },
      { url: 'https://gateway.pinata.cloud', timeout: 8000, priority: 2 },
      { url: 'https://cloudflare-ipfs.com', timeout: 10000, priority: 3 },
      { url: 'https://dweb.link', timeout: 10000, priority: 4 },
      { url: 'https://ipfs.fleek.co', timeout: 12000, priority: 5 },
      { url: 'https://gateway.ipfs.io', timeout: 15000, priority: 6 }
    ];

    // Sort gateways by priority
    this.gateways.sort((a, b) => a.priority - b.priority);
    
    // Initialize IPFS client with authentication if available
    const clientOptions: any = { 
      url: this.config.apiUrl,
      timeout: this.config.timeout
    };

    // Add authentication headers if configured
    if (process.env.IPFS_PROJECT_ID && process.env.IPFS_API_SECRET) {
      const auth = 'Basic ' + Buffer.from(
        process.env.IPFS_PROJECT_ID + ':' + process.env.IPFS_API_SECRET
      ).toString('base64');
      
      clientOptions.headers = {
        authorization: auth
      };
    }

    this.ipfs = create(clientOptions);
  }

  async initialize(): Promise<void> {
    try {
      // Test IPFS connection
      await this.testConnection();
      
      // Test gateway connectivity
      await this.testGateways();
      
      this.logger.info('IPFS service initialized successfully', {
        apiUrl: this.config.apiUrl,
        gatewayCount: this.gateways.length,
        primaryGateway: this.gateways[0]?.url || 'unknown'
      });
    } catch (error) {
      this.logger.error('IPFS service initialization failed:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Test basic IPFS functionality
      const testCid = await this.storeDocument('health check test');
      if (!testCid) {
        return false;
      }

      // Test retrieval
      const retrieved = await this.retrieveDocument(testCid);
      return retrieved === 'health check test';
    } catch (error) {
      this.logger.error('IPFS service health check failed:', error);
      return false;
    }
  }

  private async testConnection(): Promise<void> {
    try {
      // Test IPFS API connection
      const version = await this.ipfs.version();
      this.logger.debug('IPFS API connection successful', { version: version.version });
    } catch (error) {
      throw new Error(`IPFS API connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async testGateways(): Promise<void> {
    const workingGateways: IPFSGateway[] = [];
    
    // Test each gateway with a known IPFS hash
    const testCid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'; // "hello world" on IPFS
    
    for (const gateway of this.gateways) {
      try {
        const url = `${gateway.url}/ipfs/${testCid}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), gateway.timeout);
        
        const response = await fetch(url, { 
          method: 'HEAD',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          workingGateways.push(gateway);
          this.logger.debug('Gateway test successful', { gateway: gateway.url });
        } else {
          this.logger.warn('Gateway test failed', { 
            gateway: gateway.url, 
            status: response.status 
          });
        }
      } catch (error) {
        this.logger.warn('Gateway test error', { 
          gateway: gateway.url, 
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    if (workingGateways.length === 0) {
      this.logger.warn('No working IPFS gateways found, using original list');
    } else {
      // Update gateway list to prioritize working ones
      this.gateways = [...workingGateways, ...this.gateways.filter(g => !workingGateways.includes(g))];
      this.logger.info('Gateway connectivity test completed', { 
        workingGateways: workingGateways.length,
        totalGateways: this.gateways.length 
      });
    }
  }

  async storeDocument(content: string | Buffer): Promise<string> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        this.logger.debug('Storing document on IPFS', { 
          attempt: attempt + 1, 
          contentSize: content.length 
        });

        const result = await this.ipfs.add(content, {
          pin: true, // Pin the content to ensure it stays available
          cidVersion: 1, // Use CIDv1 for better compatibility
          hashAlg: 'sha2-256'
        });
        
        const cid = result.cid.toString();
        
        this.logger.info('Document stored successfully on IPFS', { 
          cid,
          size: result.size,
          attempt: attempt + 1
        });

        // Verify the upload by attempting to retrieve metadata
        await this.validateStoredDocument(cid);
        
        return cid;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`IPFS store attempt ${attempt + 1} failed:`, {
          error: lastError.message,
          attempt: attempt + 1,
          maxRetries: this.maxRetries
        });
        
        if (attempt < this.maxRetries - 1) {
          const delay = this.retryDelay * Math.pow(2, attempt); // Exponential backoff
          await this.delay(delay);
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
        this.logger.debug('Retrieving document from IPFS', { cid, attempt: attempt + 1 });

        const chunks = [];
        for await (const chunk of this.ipfs.cat(cid, { timeout: this.config.timeout })) {
          chunks.push(chunk);
        }
        
        const content = Buffer.concat(chunks).toString();
        
        this.logger.debug('Document retrieved successfully from IPFS', { 
          cid, 
          size: content.length,
          attempt: attempt + 1
        });
        
        return content;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`IPFS retrieve attempt ${attempt + 1} failed for CID ${cid}:`, {
          error: lastError.message,
          attempt: attempt + 1
        });
        
        if (attempt < this.maxRetries - 1) {
          const delay = this.retryDelay * Math.pow(2, attempt);
          await this.delay(delay);
        }
      }
    }
    
    this.logger.error(`Failed to retrieve document ${cid} from IPFS after all retries:`, lastError);
    throw lastError || new Error(`IPFS retrieve operation failed for CID: ${cid}`);
  }

  private async validateStoredDocument(cid: string): Promise<boolean> {
    try {
      // Try to get the object stats to verify it exists
      const stats = await this.ipfs.object.stat(cid, { timeout: 5000 });
      return stats && stats.Hash === cid;
    } catch (error) {
      this.logger.warn('Document validation failed', { cid, error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    }
  }

  async getGatewayUrl(cid: string): Promise<string> {
    return `${this.gateways[this.currentGatewayIndex]?.url || 'https://ipfs.io'}/ipfs/${cid}`;
  }

  async getGatewayUrlWithFallback(cid: string): Promise<string> {
    // Try to find a working gateway for this specific CID
    for (let i = 0; i < this.gateways.length; i++) {
      const gateway = this.gateways[i];
      if (!gateway) continue;
      
      const gatewayUrl = `${gateway.url}/ipfs/${cid}`;
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), gateway.timeout);
        
        const response = await fetch(gatewayUrl, { 
          method: 'HEAD',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          this.currentGatewayIndex = i; // Update to working gateway
          this.logger.debug('Gateway availability verified', { gateway: gateway.url, cid });
          return gatewayUrl;
        }
      } catch (error) {
        this.logger.debug('Gateway check failed', { 
          gateway: gateway.url, 
          cid,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        continue;
      }
    }
    
    // If all gateways fail, return the primary gateway URL
    this.logger.warn(`All IPFS gateways failed for CID ${cid}, using primary gateway`);
    return `${this.gateways[0]?.url || 'https://ipfs.io'}/ipfs/${cid}`;
  }

  async validateCID(cid: string): Promise<boolean> {
    try {
      // Basic CID format validation
      if (!cid || typeof cid !== 'string') {
        return false;
      }

      // Try to retrieve object stats to validate CID exists
      const stats = await this.ipfs.object.stat(cid, { timeout: 10000 });
      return !!stats;
    } catch (error) {
      this.logger.debug(`CID validation failed for ${cid}:`, error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  async pinDocument(cid: string): Promise<boolean> {
    try {
      await this.ipfs.pin.add(cid);
      this.logger.info('Document pinned successfully', { cid });
      return true;
    } catch (error) {
      this.logger.error('Failed to pin document:', { cid, error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    }
  }

  async unpinDocument(cid: string): Promise<boolean> {
    try {
      await this.ipfs.pin.rm(cid);
      this.logger.info('Document unpinned successfully', { cid });
      return true;
    } catch (error) {
      this.logger.error('Failed to unpin document:', { cid, error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    }
  }

  async getDocumentStats(cid: string): Promise<{
    size: number;
    cumulativeSize: number;
    blocks: number;
    type: string;
  } | null> {
    try {
      const stats = await this.ipfs.object.stat(cid);
      return {
        size: stats.DataSize || 0,
        cumulativeSize: stats.CumulativeSize || 0,
        blocks: stats.NumLinks || 0,
        type: 'object'
      };
    } catch (error) {
      this.logger.error('Failed to get document stats:', { cid, error: error instanceof Error ? error.message : 'Unknown error' });
      return null;
    }
  }

  getGatewayStatus(): { 
    currentGateway: string; 
    availableGateways: IPFSGateway[];
    config: IPFSConfig;
  } {
    return {
      currentGateway: this.gateways[this.currentGatewayIndex]?.url || 'none',
      availableGateways: this.gateways,
      config: this.config
    };
  }

  async getServiceStats(): Promise<{
    version?: string;
    peerId?: string;
    repo?: any;
    isOnline: boolean;
    gatewayCount: number;
    currentGateway: string;
  }> {
    try {
      const [version, id] = await Promise.allSettled([
        this.ipfs.version(),
        this.ipfs.id()
      ]);

      return {
        version: version.status === 'fulfilled' ? version.value.version : undefined,
        peerId: id.status === 'fulfilled' ? id.value.id : undefined,
        isOnline: true,
        gatewayCount: this.gateways.length,
        currentGateway: this.gateways[this.currentGatewayIndex]?.url || 'unknown'
      };
    } catch (error) {
      this.logger.error('Failed to get IPFS service stats:', error);
      return {
        isOnline: false,
        gatewayCount: this.gateways.length,
        currentGateway: 'unknown'
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 