# Veritas AI Agent - Performance Testing Guide

**Version:** 1.1.0  
**Last Updated:** January 2025  
**Status:** Production Ready

## Table of Contents

1. [Overview](#overview)
2. [Performance Requirements](#performance-requirements)
3. [Test Environment Setup](#test-environment-setup)
4. [Test Scenarios](#test-scenarios)
5. [Load Testing](#load-testing)
6. [Stress Testing](#stress-testing)
7. [Endurance Testing](#endurance-testing)
8. [Spike Testing](#spike-testing)
9. [Scalability Testing](#scalability-testing)
10. [Database Performance Testing](#database-performance-testing)
11. [Cache Performance Testing](#cache-performance-testing)
12. [Network Performance Testing](#network-performance-testing)
13. [Browser Extension Performance](#browser-extension-performance)
14. [Monitoring and Metrics](#monitoring-and-metrics)
15. [Performance Regression Testing](#performance-regression-testing)
16. [Performance Optimization](#performance-optimization)
17. [Reporting and Analysis](#reporting-and-analysis)

## Overview

This performance testing guide provides comprehensive procedures for testing the performance characteristics of the Veritas AI Agent system. The guide covers load testing, stress testing, scalability testing, and performance optimization to ensure the system meets production requirements.

### Performance Testing Objectives

1. **Validate Performance Requirements**: Ensure system meets specified performance targets
2. **Identify Bottlenecks**: Identify performance bottlenecks and optimization opportunities
3. **Capacity Planning**: Determine system capacity and scaling requirements
4. **Regression Testing**: Detect performance regressions in new releases
5. **Optimization**: Guide performance optimization efforts

### Key Performance Indicators (KPIs)

- **Response Time**: p95 latency ≤ 300ms for verification requests
- **Throughput**: Support 10,000+ concurrent verifications
- **Availability**: 99.9% uptime SLA
- **Error Rate**: < 1% error rate under normal load
- **Resource Utilization**: CPU < 80%, Memory < 85%, Disk < 90%

## Performance Requirements

### Functional Requirements

| Component | Metric | Target | Acceptable | Critical |
|-----------|--------|--------|------------|----------|
| Verification API | p95 Response Time | ≤ 300ms | ≤ 500ms | ≤ 1000ms |
| Verification API | Throughput | 1000 req/s | 500 req/s | 100 req/s |
| Data Pipeline | Processing Time | ≤ 60s | ≤ 120s | ≤ 300s |
| Database | Query Response | ≤ 100ms | ≤ 200ms | ≤ 500ms |
| Cache | Hit Rate | ≥ 80% | ≥ 70% | ≥ 50% |
| Browser Extension | UI Response | ≤ 16ms | ≤ 32ms | ≤ 64ms |

### Non-Functional Requirements

| Requirement | Target | Measurement |
|-------------|--------|-------------|
| Scalability | 10x load increase | Horizontal scaling |
| Reliability | 99.9% uptime | Availability monitoring |
| Resource Efficiency | < 80% utilization | Resource monitoring |
| Recovery Time | < 5 minutes | Failover testing |
| Data Consistency | 100% accuracy | Data integrity checks |

## Test Environment Setup

### 1. Test Infrastructure

#### Production-Like Environment

```bash
# Kubernetes cluster configuration
kubectl config use-context veritas-test-cluster

# Verify cluster resources
kubectl get nodes -o wide
kubectl top nodes
kubectl get pods --all-namespaces
```

#### Test Data Setup

```bash
# Create test data sets
kubectl apply -f test/data/test-datasets.yaml

# Verify test data
kubectl exec -it veritas-postgres-0 -n database -- psql -U postgres -d veritas -c "SELECT COUNT(*) FROM veritas_source_documents;"
kubectl exec -it veritas-postgres-0 -n database -- psql -U postgres -d veritas -c "SELECT COUNT(*) FROM veritas_document_embeddings;"
```

### 2. Monitoring Setup

#### Prometheus Configuration

```yaml
# test/monitoring/prometheus-test.yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'veritas-backend'
    static_configs:
      - targets: ['veritas-backend.veritas.svc.cluster.local:9090']
    metrics_path: '/metrics'
    scrape_interval: 5s

  - job_name: 'veritas-data-pipeline'
    static_configs:
      - targets: ['veritas-data-pipeline.veritas.svc.cluster.local:8000']
    metrics_path: '/metrics'
    scrape_interval: 5s
```

#### Grafana Dashboards

```bash
# Import test dashboards
kubectl apply -f test/monitoring/grafana-test-dashboards.yaml

# Access Grafana
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80
```

### 3. Load Testing Tools

#### K6 Test Runner

```bash
# Install K6
curl -L https://github.com/grafana/k6/releases/download/v0.47.0/k6-v0.47.0-linux-amd64.tar.gz | tar xz
sudo cp k6-v0.47.0-linux-amd64/k6 /usr/local/bin

# Verify installation
k6 version
```

#### Artillery Test Runner

```bash
# Install Artillery
npm install -g artillery

# Verify installation
artillery --version
```

## Test Scenarios

### 1. Baseline Performance Test

#### Objective

Establish baseline performance metrics under normal load conditions.

#### Test Configuration

```javascript
// test/scenarios/baseline-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 10 },   // Ramp up to 10 users
    { duration: '5m', target: 10 },   // Stay at 10 users
    { duration: '2m', target: 0 },    // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'], // 95% of requests must complete below 300ms
    http_req_failed: ['rate<0.01'],   // Error rate must be less than 1%
  },
};

export default function () {
  const response = http.post('https://api.veritas.ai/verify', {
    claim_text: 'The Earth is round',
    api_key: __ENV.API_KEY,
  });

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 300ms': (r) => r.timings.duration < 300,
  });

  sleep(1);
}
```

#### Execution

```bash
# Run baseline test
k6 run --env API_KEY=test-api-key test/scenarios/baseline-test.js

# Monitor results
kubectl logs -n monitoring -l app=prometheus --tail=100
```

### 2. Load Testing Scenarios

#### Normal Load Test

```javascript
// test/scenarios/normal-load-test.js
export const options = {
  stages: [
    { duration: '2m', target: 50 },   // Ramp up to 50 users
    { duration: '10m', target: 50 },  // Stay at 50 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
    http_reqs: ['rate>40'],           // Must handle 40+ req/s
  },
};
```

#### Peak Load Test

```javascript
// test/scenarios/peak-load-test.js
export const options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
    http_reqs: ['rate>80'],
  },
};
```

### 3. Stress Testing Scenarios

#### Stress Test

```javascript
// test/scenarios/stress-test.js
export const options = {
  stages: [
    { duration: '2m', target: 50 },   // Normal load
    { duration: '2m', target: 100 },  // Increase load
    { duration: '2m', target: 200 },  // Stress load
    { duration: '2m', target: 300 },  // Peak stress
    { duration: '2m', target: 0 },    // Recovery
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.10'],
  },
};
```

#### Breakpoint Test

```javascript
// test/scenarios/breakpoint-test.js
export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '1m', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '1m', target: 200 },
    { duration: '1m', target: 500 },
    { duration: '1m', target: 1000 },
    { duration: '1m', target: 0 },
  ],
};
```

## Load Testing

### 1. API Load Testing

#### Verification API Test

```javascript
// test/load/verification-api-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const testClaims = [
  'The Earth is round',
  'Water boils at 100 degrees Celsius',
  'The speed of light is 299,792,458 meters per second',
  'DNA is a double helix',
  'The human body has 206 bones',
];

export const options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '10m', target: 100 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
    http_reqs: ['rate>80'],
  },
};

export default function () {
  const claim = testClaims[Math.floor(Math.random() * testClaims.length)];
  
  const response = http.post('https://api.veritas.ai/verify', {
    claim_text: claim,
    api_key: __ENV.API_KEY,
  });

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 300ms': (r) => r.timings.duration < 300,
    'verification result': (r) => {
      const body = JSON.parse(r.body);
      return body.status === 'VERIFIED' || body.status === 'UNVERIFIED';
    },
  });

  sleep(1);
}
```

#### Health Check Test

```javascript
// test/load/health-check-test.js
export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '5m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<100'],
    http_req_failed: ['rate<0.001'],
  },
};

export default function () {
  const response = http.get('https://api.veritas.ai/health');

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 100ms': (r) => r.timings.duration < 100,
    'health check passed': (r) => {
      const body = JSON.parse(r.body);
      return body.status === 'healthy';
    },
  });

  sleep(1);
}
```

### 2. Data Pipeline Load Testing

#### Document Upload Test

```javascript
// test/load/document-upload-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const testDocuments = new SharedArray('documents', function () {
  return [
    { name: 'test1.txt', content: 'This is test document 1' },
    { name: 'test2.txt', content: 'This is test document 2' },
    { name: 'test3.txt', content: 'This is test document 3' },
  ];
});

export const options = {
  stages: [
    { duration: '2m', target: 20 },
    { duration: '10m', target: 20 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<60000'], // 60 seconds for document processing
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const doc = testDocuments[Math.floor(Math.random() * testDocuments.length)];
  
  const formData = {
    file: http.file(doc.content, doc.name, 'text/plain'),
  };

  const response = http.post('https://pipeline.veritas.ai/ingest', formData);

  check(response, {
    'status is 200': (r) => r.status === 200,
    'document accepted': (r) => {
      const body = JSON.parse(r.body);
      return body.status === 'PENDING';
    },
  });

  sleep(5); // Longer sleep for document processing
}
```

## Stress Testing

### 1. System Stress Test

#### High Load Stress Test

```javascript
// test/stress/high-load-stress-test.js
export const options = {
  stages: [
    { duration: '2m', target: 50 },   // Normal load
    { duration: '2m', target: 100 },  // High load
    { duration: '2m', target: 200 },  // Very high load
    { duration: '2m', target: 500 },  // Extreme load
    { duration: '2m', target: 1000 }, // Maximum load
    { duration: '5m', target: 1000 }, // Sustained maximum
    { duration: '2m', target: 0 },    // Recovery
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.20'],
  },
};
```

#### Resource Stress Test

```javascript
// test/stress/resource-stress-test.js
export const options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '10m', target: 100 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.10'],
  },
};

export default function () {
  // Simulate resource-intensive operations
  const response = http.post('https://api.veritas.ai/verify', {
    claim_text: 'This is a very long and complex claim that requires extensive processing and multiple database queries to verify its accuracy against various sources and perform detailed analysis',
    api_key: __ENV.API_KEY,
  });

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 1000ms': (r) => r.timings.duration < 1000,
  });

  sleep(2);
}
```

### 2. Database Stress Test

#### Database Connection Test

```javascript
// test/stress/database-stress-test.js
export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '1m', target: 200 },
    { duration: '1m', target: 500 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.10'],
  },
};

export default function () {
  // Test database-intensive operations
  const response = http.get('https://api.veritas.ai/health/database');

  check(response, {
    'status is 200': (r) => r.status === 200,
    'database healthy': (r) => {
      const body = JSON.parse(r.body);
      return body.status === 'healthy';
    },
  });

  sleep(1);
}
```

## Endurance Testing

### 1. Long-Running Load Test

#### Sustained Load Test

```javascript
// test/endurance/sustained-load-test.js
export const options = {
  stages: [
    { duration: '5m', target: 50 },   // Ramp up
    { duration: '2h', target: 50 },   // Sustained load for 2 hours
    { duration: '5m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
    http_reqs: ['rate>40'],
  },
};
```

#### Memory Leak Test

```javascript
// test/endurance/memory-leak-test.js
export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '4h', target: 10 },   // 4 hours of sustained load
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};
```

## Spike Testing

### 1. Traffic Spike Test

#### Sudden Load Increase

```javascript
// test/spike/traffic-spike-test.js
export const options = {
  stages: [
    { duration: '2m', target: 10 },   // Normal load
    { duration: '30s', target: 200 }, // Sudden spike
    { duration: '2m', target: 200 },  // Sustained spike
    { duration: '30s', target: 10 },  // Return to normal
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.20'],
  },
};
```

#### Gradual Spike Test

```javascript
// test/spike/gradual-spike-test.js
export const options = {
  stages: [
    { duration: '2m', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '1m', target: 200 },
    { duration: '1m', target: 500 },
    { duration: '2m', target: 500 },
    { duration: '1m', target: 10 },
    { duration: '2m', target: 0 },
  ],
};
```

## Scalability Testing

### 1. Horizontal Scaling Test

#### Auto-scaling Test

```javascript
// test/scalability/auto-scaling-test.js
export const options = {
  stages: [
    { duration: '2m', target: 10 },   // Initial load
    { duration: '2m', target: 50 },   // Trigger scaling
    { duration: '2m', target: 100 },  // More scaling
    { duration: '2m', target: 200 },  // Maximum scaling
    { duration: '5m', target: 200 },  // Sustained high load
    { duration: '2m', target: 10 },   // Scale down
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.10'],
  },
};
```

#### Manual Scaling Test

```bash
# Test manual scaling
kubectl scale deployment veritas-backend --replicas=3 -n veritas
kubectl scale deployment veritas-backend --replicas=5 -n veritas
kubectl scale deployment veritas-backend --replicas=10 -n veritas
kubectl scale deployment veritas-backend --replicas=1 -n veritas
```

## Database Performance Testing

### 1. Database Load Test

#### Query Performance Test

```javascript
// test/database/query-performance-test.js
export const options = {
  stages: [
    { duration: '2m', target: 20 },
    { duration: '10m', target: 20 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // Test database-intensive operations
  const response = http.get('https://api.veritas.ai/metrics');

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 200ms': (r) => r.timings.duration < 200,
  });

  sleep(1);
}
```

#### Connection Pool Test

```javascript
// test/database/connection-pool-test.js
export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '1m', target: 200 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.10'],
  },
};
```

### 2. Database Monitoring

#### Database Metrics

```bash
# Monitor database performance
kubectl exec -it veritas-postgres-0 -n database -- psql -U postgres -d veritas -c "
SELECT 
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation
FROM pg_stats 
WHERE schemaname = 'public'
ORDER BY n_distinct DESC;
"

# Check slow queries
kubectl exec -it veritas-postgres-0 -n database -- psql -U postgres -d veritas -c "
SELECT 
  query,
  calls,
  total_time,
  mean_time,
  rows
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;
"
```

## Cache Performance Testing

### 1. Cache Hit Rate Test

#### Cache Performance Test

```javascript
// test/cache/cache-performance-test.js
export const options = {
  stages: [
    { duration: '2m', target: 50 },
    { duration: '10m', target: 50 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<100'], // Cache should be fast
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // Test cached responses
  const testClaims = [
    'The Earth is round',
    'Water boils at 100 degrees Celsius',
    'The speed of light is 299,792,458 meters per second',
  ];

  const claim = testClaims[Math.floor(Math.random() * testClaims.length)];
  
  const response = http.post('https://api.veritas.ai/verify', {
    claim_text: claim,
    api_key: __ENV.API_KEY,
  });

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 100ms': (r) => r.timings.duration < 100,
  });

  sleep(0.5); // Shorter sleep for cache testing
}
```

### 2. Cache Monitoring

#### Redis Performance

```bash
# Monitor Redis performance
kubectl exec -it veritas-redis-master-0 -n cache -- redis-cli -a VERITAS_REDIS_PASSWORD INFO memory
kubectl exec -it veritas-redis-master-0 -n cache -- redis-cli -a VERITAS_REDIS_PASSWORD INFO stats
kubectl exec -it veritas-redis-master-0 -n cache -- redis-cli -a VERITAS_REDIS_PASSWORD INFO keyspace
```

## Network Performance Testing

### 1. Network Latency Test

#### Latency Test

```javascript
// test/network/latency-test.js
export const options = {
  stages: [
    { duration: '2m', target: 10 },
    { duration: '10m', target: 10 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<50'], // Network latency should be low
    http_req_failed: ['rate<0.001'],
  },
};

export default function () {
  // Test network latency
  const response = http.get('https://api.veritas.ai/health');

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 50ms': (r) => r.timings.duration < 50,
  });

  sleep(1);
}
```

### 2. Network Throughput Test

#### Throughput Test

```javascript
// test/network/throughput-test.js
export const options = {
  stages: [
    { duration: '1m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_reqs: ['rate>80'], // Must handle 80+ req/s
    http_req_failed: ['rate<0.01'],
  },
};
```

## Browser Extension Performance

### 1. Extension Load Test

#### Extension Performance Test

```javascript
// test/extension/extension-performance-test.js
export const options = {
  stages: [
    { duration: '2m', target: 50 },
    { duration: '10m', target: 50 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<16'], // UI response time
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // Simulate extension API calls
  const response = http.post('https://api.veritas.ai/verify', {
    claim_text: 'Test claim for extension',
    api_key: __ENV.API_KEY,
  });

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 16ms': (r) => r.timings.duration < 16,
  });

  sleep(0.1); // Very short sleep for UI testing
}
```

### 2. Extension Memory Test

#### Memory Usage Test

```javascript
// test/extension/memory-test.js
export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '1h', target: 10 },   // 1 hour of sustained use
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<32'],
    http_req_failed: ['rate<0.01'],
  },
};
```

## Monitoring and Metrics

### 1. Performance Metrics Collection

#### Prometheus Metrics

```yaml
# test/monitoring/performance-metrics.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: performance-metrics-config
  namespace: monitoring
data:
  prometheus.yml: |
    global:
      scrape_interval: 5s
      evaluation_interval: 5s

    scrape_configs:
      - job_name: 'performance-test'
        static_configs:
          - targets: ['localhost:9090']
        metrics_path: '/metrics'
        scrape_interval: 1s
```

#### Grafana Dashboards

```json
// test/monitoring/performance-dashboard.json
{
  "dashboard": {
    "title": "Performance Test Results",
    "panels": [
      {
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "p95 Response Time"
          }
        ]
      },
      {
        "title": "Throughput Over Time",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])",
            "legendFormat": "Requests/sec"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=~\"5..\"}[5m]) / rate(http_requests_total[5m])",
            "legendFormat": "Error Rate"
          }
        ]
      },
      {
        "title": "Resource Utilization",
        "type": "graph",
        "targets": [
          {
            "expr": "container_cpu_usage_seconds_total",
            "legendFormat": "CPU Usage"
          },
          {
            "expr": "container_memory_usage_bytes",
            "legendFormat": "Memory Usage"
          }
        ]
      }
    ]
  }
}
```

### 2. Real-time Monitoring

#### Live Monitoring Script

```bash
#!/bin/bash
# test/monitoring/live-monitor.sh

echo "=== Performance Test Live Monitoring ==="
echo "Timestamp: $(date)"
echo ""

# Check pod status
echo "Pod Status:"
kubectl get pods -n veritas -o wide
echo ""

# Check resource usage
echo "Resource Usage:"
kubectl top pods -n veritas
echo ""

# Check database connections
echo "Database Connections:"
kubectl exec -it veritas-postgres-0 -n database -- psql -U postgres -d veritas -c "SELECT count(*) FROM pg_stat_activity;"
echo ""

# Check cache hit rate
echo "Cache Hit Rate:"
kubectl exec -it veritas-redis-master-0 -n cache -- redis-cli -a VERITAS_REDIS_PASSWORD INFO stats | grep keyspace_hits
echo ""

sleep 30
```

## Performance Regression Testing

### 1. Automated Regression Testing

#### Regression Test Suite

```javascript
// test/regression/regression-test-suite.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 50 },
    { duration: '10m', target: 50 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
    http_reqs: ['rate>40'],
  },
};

export default function () {
  // Test critical paths
  const tests = [
    {
      name: 'Health Check',
      method: 'GET',
      url: 'https://api.veritas.ai/health',
      expectedStatus: 200,
      maxDuration: 100,
    },
    {
      name: 'Verification API',
      method: 'POST',
      url: 'https://api.veritas.ai/verify',
      body: { claim_text: 'Test claim', api_key: __ENV.API_KEY },
      expectedStatus: 200,
      maxDuration: 300,
    },
  ];

  tests.forEach(test => {
    const response = http.request(test.method, test.url, test.body || null, {
      headers: { 'Content-Type': 'application/json' },
    });

    check(response, {
      [`${test.name} status is ${test.expectedStatus}`]: (r) => r.status === test.expectedStatus,
      [`${test.name} response time < ${test.maxDuration}ms`]: (r) => r.timings.duration < test.maxDuration,
    });
  });

  sleep(1);
}
```

### 2. Baseline Comparison

#### Baseline Comparison Script

```bash
#!/bin/bash
# test/regression/compare-baseline.sh

# Run regression test
k6 run --out json=regression-results.json test/regression/regression-test-suite.js

# Compare with baseline
python3 test/regression/compare_metrics.py \
  --baseline baseline-results.json \
  --current regression-results.json \
  --threshold 0.1
```

## Performance Optimization

### 1. Bottleneck Identification

#### Performance Profiling

```bash
# Profile application performance
kubectl exec -it veritas-backend-xxx -n veritas -- node --prof app.js

# Analyze profiling data
kubectl exec -it veritas-backend-xxx -n veritas -- node --prof-process isolate-*.log > profile.txt
```

#### Database Optimization

```sql
-- Analyze slow queries
SELECT 
  query,
  calls,
  total_time,
  mean_time,
  rows
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;

-- Check index usage
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes 
ORDER BY idx_scan DESC;
```

### 2. Optimization Strategies

#### Application Optimization

```javascript
// Optimization strategies
// 1. Connection pooling
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// 2. Caching
const cache = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  maxRetriesPerRequest: 3,
});

// 3. Request batching
const batchRequests = async (requests) => {
  return Promise.all(requests.map(req => processRequest(req)));
};
```

#### Infrastructure Optimization

```yaml
# Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: veritas-backend-hpa
  namespace: veritas
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: veritas-backend
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

## Reporting and Analysis

### 1. Performance Test Reports

#### HTML Report Generation

```javascript
// test/reporting/generate-report.js
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

export function handleSummary(data) {
  return {
    "test-results.html": htmlReport(data),
    "test-results.json": JSON.stringify(data),
  };
}
```

#### Performance Analysis Script

```python
#!/usr/bin/env python3
# test/reporting/analyze_performance.py

import json
import pandas as pd
import matplotlib.pyplot as plt

def analyze_performance_results(results_file):
    with open(results_file, 'r') as f:
        data = json.load(f)
    
    # Extract metrics
    metrics = data['metrics']
    
    # Create performance summary
    summary = {
        'total_requests': metrics['http_reqs']['count'],
        'avg_response_time': metrics['http_req_duration']['avg'],
        'p95_response_time': metrics['http_req_duration']['p(95)'],
        'error_rate': metrics['http_req_failed']['rate'],
        'throughput': metrics['http_reqs']['rate'],
    }
    
    return summary

def generate_performance_report(test_results):
    # Generate comprehensive report
    report = {
        'test_summary': test_results,
        'performance_analysis': analyze_performance_results(test_results),
        'recommendations': generate_recommendations(test_results),
    }
    
    return report
```

### 2. Performance Dashboard

#### Grafana Dashboard Configuration

```json
// test/dashboards/performance-dashboard.json
{
  "dashboard": {
    "title": "Performance Test Results",
    "panels": [
      {
        "title": "Response Time Distribution",
        "type": "heatmap",
        "targets": [
          {
            "expr": "rate(http_request_duration_seconds_bucket[5m])",
            "format": "heatmap"
          }
        ]
      },
      {
        "title": "Throughput Over Time",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])",
            "legendFormat": "Requests/sec"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=~\"5..\"}[5m]) / rate(http_requests_total[5m])",
            "legendFormat": "Error Rate"
          }
        ]
      },
      {
        "title": "Resource Utilization",
        "type": "graph",
        "targets": [
          {
            "expr": "container_cpu_usage_seconds_total",
            "legendFormat": "CPU Usage"
          },
          {
            "expr": "container_memory_usage_bytes",
            "legendFormat": "Memory Usage"
          }
        ]
      }
    ]
  }
}
```

---

## Appendix

### A. Test Data Sets

#### Sample Test Claims

```json
{
  "test_claims": [
    "The Earth is round",
    "Water boils at 100 degrees Celsius at sea level",
    "The speed of light is 299,792,458 meters per second",
    "DNA is a double helix structure",
    "The human body has 206 bones",
    "Photosynthesis is the process by which plants convert sunlight into energy",
    "The Great Wall of China is visible from space",
    "Bats are mammals, not birds",
    "The heart pumps blood through the circulatory system",
    "Gravity is a fundamental force of nature"
  ]
}
```

### B. Performance Test Commands

#### Quick Performance Test

```bash
# Run quick performance test
k6 run --env API_KEY=test-key test/scenarios/baseline-test.js

# Run with custom parameters
k6 run --env API_KEY=test-key --env BASE_URL=https://api.veritas.ai test/scenarios/baseline-test.js

# Run with different load patterns
k6 run --env API_KEY=test-key test/scenarios/stress-test.js
```

### C. Monitoring Commands

#### Real-time Monitoring

```bash
# Monitor pods
kubectl get pods -n veritas -w

# Monitor resource usage
kubectl top pods -n veritas -w

# Monitor logs
kubectl logs -f -n veritas -l app=veritas-backend

# Monitor metrics
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090
```

### D. Performance Optimization Checklist

- [ ] **Database Optimization**
  - [ ] Query optimization
  - [ ] Index optimization
  - [ ] Connection pooling
  - [ ] Query caching

- [ ] **Application Optimization**
  - [ ] Code profiling
  - [ ] Memory optimization
  - [ ] Async processing
  - [ ] Request batching

- [ ] **Infrastructure Optimization**
  - [ ] Resource allocation
  - [ ] Auto-scaling
  - [ ] Load balancing
  - [ ] Network optimization

- [ ] **Caching Optimization**
  - [ ] Cache hit rate
  - [ ] Cache invalidation
  - [ ] Cache warming
  - [ ] Cache size optimization

---

**Note**: This performance testing guide should be updated regularly to reflect changes in the system architecture and performance requirements. All performance tests should be run in a controlled environment that closely resembles production.
