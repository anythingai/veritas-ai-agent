import { Logger } from 'winston';
import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { DatabaseService } from './database.service';
import { CacheService } from './cache.service';

export interface VerificationMetrics {
  claimLength: number;
  documentsFound: number;
  processingTimeMs: number;
  status: string;
  confidence: number;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
}

export interface BusinessMetrics {
  uniqueUsers: number;
  dailyVerifications: number;
  averageResponseTime: number;
  errorRate: number;
  cacheHitRate: number;
}

export class MetricsService {
  // Verification metrics
  private verificationRequestsTotal: Counter;
  private verificationRequestsDuration: Histogram;
  private verificationConfidence: Histogram;
  private verificationStatus: Counter;
  private verificationDocumentsFound: Histogram;
  
  // Cache metrics
  private cacheHitsTotal: Counter;
  private cacheMissesTotal: Counter;
  private cacheSize: Gauge;
  private cacheEvictions: Counter;
  
  // System metrics
  private activeConnections: Gauge;
  private memoryUsage: Gauge;
  private cpuUsage: Gauge;
  private diskUsage: Gauge;
  private networkConnections: Gauge;
  
  // Error metrics
  private errorsTotal: Counter;
  private externalServiceErrors: Counter;
  private databaseErrors: Counter;
  private validationErrors: Counter;
  
  // Business metrics
  private uniqueUsers: Gauge;
  private dailyVerifications: Counter;
  private averageResponseTime: Histogram;
  private apiUsageByEndpoint: Counter;
  private apiUsageByUser: Counter;
  
  // Security metrics
  private securityEvents: Counter;
  private rateLimitExceeded: Counter;
  private authenticationFailures: Counter;
  
  // Performance metrics
  private slowQueries: Counter;
  private externalServiceLatency: Histogram;
  private databaseLatency: Histogram;

  constructor(private logger: Logger, private databaseService: DatabaseService, private cacheService: CacheService) {
    // Initialize all Prometheus metrics
    this.verificationRequestsTotal = new Counter({
      name: 'veritas_verification_requests_total',
      help: 'Total number of verification requests',
      labelNames: ['status', 'source']
    });

    this.verificationRequestsDuration = new Histogram({
      name: 'veritas_verification_duration_seconds',
      help: 'Duration of verification requests',
      labelNames: ['status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10]
    });

    this.verificationConfidence = new Histogram({
      name: 'veritas_verification_confidence',
      help: 'Confidence scores of verifications',
      buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    });

    this.verificationStatus = new Counter({
      name: 'veritas_verification_status_total',
      help: 'Verification status counts',
      labelNames: ['status']
    });

    this.verificationDocumentsFound = new Histogram({
      name: 'veritas_documents_found',
      help: 'Number of documents found per verification',
      buckets: [1, 2, 3, 4, 5, 10, 20, 50]
    });

    // Cache metrics
    this.cacheHitsTotal = new Counter({
      name: 'veritas_cache_hits_total',
      help: 'Total cache hits'
    });

    this.cacheMissesTotal = new Counter({
      name: 'veritas_cache_misses_total',
      help: 'Total cache misses'
    });

    this.cacheSize = new Gauge({
      name: 'veritas_cache_size',
      help: 'Current cache size'
    });

    this.cacheEvictions = new Counter({
      name: 'veritas_cache_evictions_total',
      help: 'Total cache evictions'
    });

    // System metrics
    this.activeConnections = new Gauge({
      name: 'veritas_active_connections',
      help: 'Number of active connections'
    });

    this.memoryUsage = new Gauge({
      name: 'veritas_memory_usage_bytes',
      help: 'Memory usage in bytes'
    });

    this.cpuUsage = new Gauge({
      name: 'veritas_cpu_usage_percent',
      help: 'CPU usage percentage'
    });

    this.diskUsage = new Gauge({
      name: 'veritas_disk_usage_bytes',
      help: 'Disk usage in bytes'
    });

    this.networkConnections = new Gauge({
      name: 'veritas_network_connections',
      help: 'Number of network connections'
    });

    // Error metrics
    this.errorsTotal = new Counter({
      name: 'veritas_errors_total',
      help: 'Total number of errors',
      labelNames: ['type']
    });

    this.externalServiceErrors = new Counter({
      name: 'veritas_external_service_errors_total',
      help: 'Total external service errors',
      labelNames: ['service']
    });

    this.databaseErrors = new Counter({
      name: 'veritas_database_errors_total',
      help: 'Total database errors'
    });

    this.validationErrors = new Counter({
      name: 'veritas_validation_errors_total',
      help: 'Total validation errors',
      labelNames: ['field', 'type']
    });

    // Business metrics
    this.uniqueUsers = new Gauge({
      name: 'veritas_unique_users',
      help: 'Number of unique users'
    });

    this.dailyVerifications = new Counter({
      name: 'veritas_daily_verifications_total',
      help: 'Daily verification count'
    });

    this.averageResponseTime = new Histogram({
      name: 'veritas_average_response_time_seconds',
      help: 'Average response time',
      buckets: [0.1, 0.5, 1, 2, 5, 10]
    });

    this.apiUsageByEndpoint = new Counter({
      name: 'veritas_api_usage_by_endpoint_total',
      help: 'API usage by endpoint',
      labelNames: ['endpoint', 'method']
    });

    this.apiUsageByUser = new Counter({
      name: 'veritas_api_usage_by_user_total',
      help: 'API usage by user',
      labelNames: ['user_id', 'endpoint']
    });

    // Security metrics
    this.securityEvents = new Counter({
      name: 'veritas_security_events_total',
      help: 'Security events',
      labelNames: ['event_type']
    });

    this.rateLimitExceeded = new Counter({
      name: 'veritas_rate_limit_exceeded_total',
      help: 'Rate limit exceeded events',
      labelNames: ['user_id', 'endpoint']
    });

    this.authenticationFailures = new Counter({
      name: 'veritas_authentication_failures_total',
      help: 'Authentication failures',
      labelNames: ['reason']
    });

    // Performance metrics
    this.slowQueries = new Counter({
      name: 'veritas_slow_queries_total',
      help: 'Slow queries',
      labelNames: ['query_type']
    });

    this.externalServiceLatency = new Histogram({
      name: 'veritas_external_service_latency_seconds',
      help: 'External service latency',
      labelNames: ['service'],
      buckets: [0.1, 0.5, 1, 2, 5, 10]
    });

    this.databaseLatency = new Histogram({
      name: 'veritas_database_latency_seconds',
      help: 'Database latency',
      labelNames: ['operation'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2]
    });

    // Register all metrics
    register.registerMetric(this.verificationRequestsTotal);
    register.registerMetric(this.verificationRequestsDuration);
    register.registerMetric(this.verificationConfidence);
    register.registerMetric(this.verificationStatus);
    register.registerMetric(this.verificationDocumentsFound);
    register.registerMetric(this.cacheHitsTotal);
    register.registerMetric(this.cacheMissesTotal);
    register.registerMetric(this.cacheSize);
    register.registerMetric(this.cacheEvictions);
    register.registerMetric(this.activeConnections);
    register.registerMetric(this.memoryUsage);
    register.registerMetric(this.cpuUsage);
    register.registerMetric(this.diskUsage);
    register.registerMetric(this.networkConnections);
    register.registerMetric(this.errorsTotal);
    register.registerMetric(this.externalServiceErrors);
    register.registerMetric(this.databaseErrors);
    register.registerMetric(this.validationErrors);
    register.registerMetric(this.uniqueUsers);
    register.registerMetric(this.dailyVerifications);
    register.registerMetric(this.averageResponseTime);
    register.registerMetric(this.apiUsageByEndpoint);
    register.registerMetric(this.apiUsageByUser);
    register.registerMetric(this.securityEvents);
    register.registerMetric(this.rateLimitExceeded);
    register.registerMetric(this.authenticationFailures);
    register.registerMetric(this.slowQueries);
    register.registerMetric(this.externalServiceLatency);
    register.registerMetric(this.databaseLatency);

    this.logger.info('Metrics service initialized with comprehensive monitoring');
  }

  recordVerificationRequest(status: string, processingTimeMs: number, source?: string, apiKeyType?: string, organization?: string): void {
    const durationSeconds = processingTimeMs / 1000;
    
    this.verificationRequestsTotal.inc({ 
      status, 
      source: source || 'unknown', 
      api_key_type: apiKeyType || 'unknown',
      organization: organization || 'unknown'
    });
    this.verificationRequestsDuration.observe({ 
      status, 
      source: source || 'unknown',
      api_key_type: apiKeyType || 'unknown'
    }, durationSeconds);
    this.verificationStatus.inc({ status });
    
    // Record daily verifications
    const today = new Date().toISOString().split('T')[0];
    this.dailyVerifications.inc({ date: today, organization: organization || 'unknown' });
  }

  recordVerificationMetrics(metrics: VerificationMetrics): void {
    this.verificationConfidence.observe({ status: metrics.status }, metrics.confidence);
    this.verificationDocumentsFound.observe({ status: metrics.status }, metrics.documentsFound);
  }

  recordCacheHit(): void {
    this.cacheHitsTotal.inc();
  }

  recordCacheMiss(): void {
    this.cacheMissesTotal.inc();
  }

  recordCacheEviction(): void {
    this.cacheEvictions.inc();
  }

  setCacheSize(size: number): void {
    this.cacheSize.set(size);
  }

  recordError(type: string, service: string, severity: string = 'medium'): void {
    this.errorsTotal.inc({ type, service, severity });
  }

  recordExternalServiceError(service: string, endpoint: string, errorType: string): void {
    this.externalServiceErrors.inc({ service, endpoint, error_type: errorType });
  }

  recordDatabaseError(operation: string, errorType: string): void {
    this.databaseErrors.inc({ operation, error_type: errorType });
  }

  recordValidationError(field: string, errorType: string): void {
    this.validationErrors.inc({ field, error_type: errorType });
  }

  recordResponseTime(endpoint: string, method: string, statusCode: number, durationSeconds: number): void {
    this.averageResponseTime.observe({ endpoint, method, status_code: statusCode.toString() }, durationSeconds);
  }

  setActiveConnections(count: number): void {
    this.activeConnections.set(count);
  }

  updateSystemMetrics(): void {
    const memUsage = process.memoryUsage();
    this.memoryUsage.set({ type: 'rss' }, memUsage.rss);
    this.memoryUsage.set({ type: 'heapUsed' }, memUsage.heapUsed);
    this.memoryUsage.set({ type: 'heapTotal' }, memUsage.heapTotal);
    this.memoryUsage.set({ type: 'external' }, memUsage.external);
  }

  setUniqueUsers(count: number, organization?: string): void {
    this.uniqueUsers.set({ organization: organization || 'unknown' }, count);
  }

  recordApiUsage(endpoint: string, method: string, statusCode: number): void {
    this.apiUsageByEndpoint.inc({ endpoint, method, status_code: statusCode.toString() });
  }

  recordApiUsageByUser(userId: string, organization: string, endpoint: string): void {
    this.apiUsageByUser.inc({ user_id: userId, organization, endpoint });
  }

  recordSecurityEvent(eventType: string, severity: string, ipAddress: string): void {
    this.securityEvents.inc({ event_type: eventType, severity, ip_address: ipAddress });
  }

  recordRateLimitExceeded(apiKeyType: string, ipAddress: string): void {
    this.rateLimitExceeded.inc({ api_key_type: apiKeyType, ip_address: ipAddress });
  }

  recordAuthenticationFailure(failureType: string, ipAddress: string): void {
    this.authenticationFailures.inc({ failure_type: failureType, ip_address: ipAddress });
  }

  recordSlowQuery(queryType: string, durationMs: number): void {
    const durationCategory = durationMs > 5000 ? 'very_slow' : 
                           durationMs > 1000 ? 'slow' : 
                           durationMs > 500 ? 'medium' : 'fast';
    this.slowQueries.inc({ query_type: queryType, duration_category: durationCategory });
  }

  recordExternalServiceLatency(service: string, endpoint: string, durationSeconds: number): void {
    this.externalServiceLatency.observe({ service, endpoint }, durationSeconds);
  }

  recordDatabaseLatency(operation: string, table: string, durationSeconds: number): void {
    this.databaseLatency.observe({ operation, table }, durationSeconds);
  }

  async getMetrics(): Promise<string> {
    try {
      return await register.metrics();
    } catch (error) {
      this.logger.error('Failed to get metrics:', error);
      throw error;
    }
  }

  async getMetricsAsJson(): Promise<any> {
    try {
      const metrics = await register.getMetricsAsJSON();
      return {
        timestamp: new Date().toISOString(),
        metrics
      };
    } catch (error) {
      this.logger.error('Failed to get metrics as JSON:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await register.metrics();
      return true;
    } catch (error) {
      this.logger.error('Metrics health check failed:', error);
      return false;
    }
  }

  // Business metrics calculation
  async calculateBusinessMetrics(): Promise<BusinessMetrics> {
    try {
      // Get analytics from database
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
      
      const analytics = await this.databaseService.getVerificationAnalytics(
        yesterdayStart.toISOString(),
        todayStart.toISOString()
      );
      
      // Get unique users using the new method
      const uniqueUsers = await this.databaseService.getUniqueUsers(
        yesterdayStart.toISOString(),
        todayStart.toISOString()
      );
      
      // Get cache metrics from internal counters
      const metricsData = await register.getMetricsAsJSON();
      const cacheHitsMetric = metricsData.find(m => m.name === 'cache_hits_total');
      const cacheMissesMetric = metricsData.find(m => m.name === 'cache_misses_total');
      
      const cacheHits = cacheHitsMetric?.values?.[0]?.value || 0;
      const cacheMisses = cacheMissesMetric?.values?.[0]?.value || 0;
      const cacheHitRate = (cacheHits + cacheMisses) > 0 ? 
        cacheHits / (cacheHits + cacheMisses) : 0;
      
      // Calculate error rate from stored metrics
      const errorRate = analytics.totalRequests > 0 ? 
        (analytics.unknownCount / analytics.totalRequests) : 0;
      
      return {
        uniqueUsers,
        dailyVerifications: analytics.totalRequests,
        averageResponseTime: analytics.averageProcessingTime / 1000, // Convert to seconds
        errorRate,
        cacheHitRate
      };
    } catch (error) {
      this.logger.error('Failed to calculate business metrics:', error);
      throw error;
    }
  }
} 