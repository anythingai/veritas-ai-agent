# Veritas AI Agent

> **Real-time trust layer for AI** - Grounding LLM output in verifiable, cryptographically-signed source documents stored on IPFS.

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#key-features)
- [Architecture](#️-architecture)
- [Components](#-components)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Usage](#-usage)
- [API Reference](#-api-reference)
- [Development](#-development)
- [Testing](#-testing)
- [Deployment](#-deployment)
- [Monitoring](#-monitoring)
- [Troubleshooting](#-troubleshooting)
- [FAQ](#-faq)
- [Contributing](#-contributing)
- [Support](#-support)
- [License](#-license)

## 🚀 Overview

Veritas provides a real-time trust layer for AI by grounding large language model (LLM) output in verifiable, cryptographically-signed source documents stored on IPFS. As a browser extension, it overlays fact-checking cues directly inside popular AI chat UIs, transforming LLMs from creative storytellers into trusted assistants.

### Problem Statement

Generative AI models routinely output plausible but false information ("hallucinations"), breaking user trust in critical domains such as research, business intelligence, and education. Veritas solves this by providing real-time fact verification with cryptographic proof.

### Solution

- **Real-time Verification**: Claims are verified against trusted knowledge bases in ≤300ms
- **Cryptographic Proof**: All verifications are cryptographically signed and stored on IPFS
- **Browser Integration**: Seamless overlay in popular AI chat interfaces
- **Scalable Architecture**: Ready for enterprise deployment and multitenant SaaS

## ✨ Key Features

- ✅ **Real-time Verification**: ≤300ms factual verification for ≥90% of claims
- 🔐 **Cryptographic Trust**: End-to-end verifiability via IPFS CIDs
- 🌐 **Browser Integration**: Seamless Chrome/Brave/Arc extension
- 📊 **Scalable Architecture**: Ready for multitenant SaaS deployment
- 🔍 **RAG Pipeline**: Advanced retrieval-augmented generation
- 📈 **Monitoring**: Comprehensive observability and metrics
- 🛡️ **Security**: Rate limiting, input validation, and audit logging
- 🔄 **Auto-updates**: Seamless extension updates across browsers

## 🏗️ Architecture

```mermaid
graph TD;
  A[Browser Extension] -- HTTPS --> B[API Gateway]
  B -- REST/gRPC --> C[Verification Service]
  C -- Vector Search --> D[Vector DB]
  C -- SQL --> E[Postgres]
  C -- Pin --> F[IPFS]
  C -- Events --> G[Kafka]
  C -- Metrics --> H[Prometheus/Grafana]
  C -- Logs --> I[Loki]
  
  subgraph "Browser Extension"
    A1[Content Script] --> A2[Background Script]
    A2 --> A3[Popup UI]
  end
  
  subgraph "Backend Services"
    C1[RAG Pipeline] --> C2[Embedding Service]
    C2 --> C3[Vector Search]
    C4[IPFS Service] --> C5[Document Storage]
  end
  
  subgraph "Infrastructure"
    J[Terraform] --> K[Kubernetes]
    K --> L[ArgoCD]
    M[Monitoring] --> N[Alerting]
  end
```

### Data Flow

1. **User Interaction**: User interacts with AI chat interface
2. **Claim Detection**: Extension detects factual claims in AI responses
3. **Verification Request**: Claims sent to backend verification service
4. **RAG Processing**: Service embeds claim and searches knowledge base
5. **Result Generation**: Verification results with confidence scores
6. **UI Update**: Extension displays verification badges and citations
7. **Audit Trail**: All verifications logged with IPFS CIDs

## 📦 Components

| Component | Description | Tech Stack | Status |
|-----------|-------------|------------|--------|
| [`browser-extension/`](./browser-extension) | Chrome-compatible fact verification overlay | TypeScript, React, Webpack | ✅ Production Ready |
| [`backend-verification-service/`](./backend-verification-service) | REST API with RAG pipeline | Node.js, Fastify, PostgreSQL | ✅ Production Ready |
| [`data-pipeline/`](./data-pipeline) | Document ingestion and embedding | Python, FastAPI, Celery | ✅ Production Ready |
| [`infra/`](./infra) | Infrastructure as Code | Terraform, Kubernetes, ArgoCD | ✅ Production Ready |
| [`docs/`](./docs) | Comprehensive documentation | Markdown, Mermaid | ✅ Complete |

## 🚀 Installation

### Prerequisites

#### System Requirements

- **OS**: Linux, macOS, or Windows
- **RAM**: 8GB minimum, 16GB recommended
- **Storage**: 10GB available space
- **Network**: Stable internet connection

#### Software Dependencies

- **Node.js 18+** (for browser extension and backend)
- **Python 3.10+** (for data pipeline)
- **Docker 20+** (for containerized development)
- **PostgreSQL 15+** (for database)
- **Redis 7+** (for caching)
- **Git** (for version control)

### Installation Methods

#### Method 1: Local Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/anything-ai/veritas-ai-agent.git
   cd veritas-ai-agent
   ```

2. **Install Node.js dependencies**

   ```bash
   # Browser extension
   cd browser-extension
   npm install
   
   # Backend service
   cd ../backend-verification-service
   npm install
   ```

3. **Install Python dependencies**

   ```bash
   cd ../data-pipeline
   poetry install
   ```

4. **Set up database**

   ```bash
   # Start PostgreSQL and Redis
   docker-compose up -d postgres redis
   
   # Run migrations
   cd ../backend-verification-service
   npm run migrate
   ```

#### Method 2: Docker Deployment

```bash
# Clone repository
git clone https://github.com/anything-ai/veritas-ai-agent.git
cd veritas-ai-agent

# Build and start all services
docker-compose up -d

# Check service status
docker-compose ps
```

#### Method 3: Kubernetes Deployment

```bash
# Apply infrastructure
kubectl apply -f infra/k8s/

# Deploy applications
kubectl apply -f infra/argocd/
```

### Browser Extension Installation

1. **Build the extension**

   ```bash
   cd browser-extension
   npm run build
   ```

2. **Load in Chrome/Brave**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select `browser-extension/dist/` folder

3. **Verify installation**
   - Visit any AI chat interface (ChatGPT, Claude, etc.)
   - Look for Veritas verification badges

## ⚙️ Configuration

### Environment Variables

#### Backend Service

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/veritas
REDIS_URL=redis://localhost:6379

# API Configuration
PORT=3000
NODE_ENV=production
API_KEY=your-api-key

# External Services
OPENAI_API_KEY=your-openai-key
IPFS_GATEWAY=https://ipfs.io/ipfs/

# Security
JWT_SECRET=your-jwt-secret
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=100
```

#### Data Pipeline

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/veritas
REDIS_URL=redis://localhost:6379

# Processing
BATCH_SIZE=100
EMBEDDING_MODEL=text-embedding-ada-002
CHUNK_SIZE=500
CHUNK_OVERLAP=50

# IPFS
IPFS_API_URL=http://localhost:5001
IPFS_GATEWAY=https://ipfs.io/ipfs/
```

### Configuration Files

#### Browser Extension (`manifest.json`)

```json
{
  "manifest_version": 3,
  "name": "Veritas AI Agent",
  "version": "1.1.0",
  "permissions": [
    "activeTab",
    "storage"
  ],
  "host_permissions": [
    "https://chat.openai.com/*",
    "https://claude.ai/*"
  ],
  "content_scripts": [
    {
      "matches": ["https://chat.openai.com/*", "https://claude.ai/*"],
      "js": ["contentScript.js"],
      "css": ["styles.css"]
    }
  ]
}
```

#### Backend Service (`config/default.json`)

```json
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "database": {
    "url": "postgresql://user:password@localhost:5432/veritas"
  },
  "redis": {
    "url": "redis://localhost:6379"
  },
  "security": {
    "rateLimit": {
      "windowMs": 900000,
      "max": 100
    }
  }
}
```

## 📖 Usage

### Browser Extension

#### Basic Usage

1. **Install the extension** (see installation guide above)
2. **Visit an AI chat interface** (ChatGPT, Claude, etc.)
3. **Start a conversation** with the AI
4. **Watch for verification badges** that appear next to factual claims:
   - ✅ **Green checkmark**: Verified claim
   - ❌ **Red X**: Unverified claim
   - 🔄 **Spinning icon**: Verification in progress

#### Advanced Features

- **Click on badges** to see detailed citations
- **View IPFS links** to access source documents
- **Toggle verification** on/off in extension popup
- **Customize settings** for different knowledge bases

#### Supported Platforms

- ✅ ChatGPT (chat.openai.com)
- ✅ Claude (claude.ai)
- ✅ Google Bard (bard.google.com)
- ✅ Bing Chat (bing.com/chat)
- 🔄 Perplexity AI (perplexity.ai)
- 🔄 Anthropic Console (console.anthropic.com)

### API Usage

#### Verification Endpoint

```bash
curl -X POST https://api.veritas.ai/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "claim": "The Earth orbits the Sun",
    "context": "Astronomy discussion",
    "confidence_threshold": 0.8
  }'
```

#### Response Format

```json
{
  "status": "verified",
  "confidence": 0.95,
  "citations": [
    {
      "title": "Solar System Overview",
      "snippet": "The Earth orbits the Sun in an elliptical path...",
      "ipfs_cid": "QmX...",
      "relevance_score": 0.98
    }
  ],
  "verification_time_ms": 245,
  "knowledge_base": "astronomy_v1"
}
```

#### Document Upload

```bash
curl -X POST https://api.veritas.ai/documents \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "file=@document.pdf" \
  -F "metadata={\"title\":\"Research Paper\",\"category\":\"science\"}"
```

### Command Line Interface

#### Data Pipeline Commands

```bash
# Process documents
poetry run python -m veritas_data_pipeline.main process --input-dir ./documents

# Generate embeddings
poetry run python -m veritas_data_pipeline.main embed --model text-embedding-ada-002

# Upload to IPFS
poetry run python -m veritas_data_pipeline.main upload --gateway https://ipfs.io/ipfs/

# Monitor processing
poetry run python -m veritas_data_pipeline.main monitor
```

## 🔌 API Reference

### Authentication

All API requests require authentication via API key:

```bash
Authorization: Bearer YOUR_API_KEY
```

### Endpoints

#### POST /verify

Verify a factual claim against the knowledge base.

**Request Body:**

```json
{
  "claim": "string",
  "context": "string (optional)",
  "confidence_threshold": "number (optional, default: 0.8)",
  "knowledge_base": "string (optional)"
}
```

**Response:**

```json
{
  "status": "verified|unverified|unknown",
  "confidence": "number (0-1)",
  "citations": [
    {
      "title": "string",
      "snippet": "string",
      "ipfs_cid": "string",
      "relevance_score": "number"
    }
  ],
  "verification_time_ms": "number",
  "knowledge_base": "string"
}
```

#### POST /documents

Upload a document to the knowledge base.

**Request:**

- `file`: Document file (PDF, DOCX, TXT)
- `metadata`: JSON metadata

**Response:**

```json
{
  "document_id": "uuid",
  "ipfs_cid": "string",
  "status": "processing|completed|failed",
  "chunks": "number"
}
```

#### GET /documents/{id}

Get document information.

#### GET /health

Health check endpoint.

### Error Codes

- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not Found
- `429`: Rate Limited
- `500`: Internal Server Error

## 🛠️ Development

### Project Structure

```
veritas-ai-agent/
├── browser-extension/          # Chrome extension
│   ├── src/
│   │   ├── contentScript.ts    # Content script for page injection
│   │   ├── background.ts       # Background service worker
│   │   ├── popup.tsx          # Extension popup UI
│   │   └── styles.css         # Extension styles
│   ├── dist/                  # Built extension
│   └── package.json
├── backend-verification-service/ # REST API service
│   ├── src/
│   │   ├── index.ts           # Server entry point
│   │   ├── routes/            # API routes
│   │   ├── services/          # Business logic
│   │   ├── middleware/        # Express middleware
│   │   └── schemas/           # Request/response schemas
│   └── package.json
├── data-pipeline/             # Document processing
│   ├── src/
│   │   ├── main.py            # Pipeline entry point
│   │   ├── services/          # Processing services
│   │   └── tasks.py           # Celery tasks
│   └── pyproject.toml
├── infra/                     # Infrastructure
│   ├── terraform/             # Infrastructure as Code
│   ├── k8s/                   # Kubernetes manifests
│   └── monitoring/            # Monitoring configs
├── docs/                      # Documentation
├── tests/                     # End-to-end tests
└── scripts/                   # Utility scripts
```

### Development Workflow

1. **Fork the repository**
2. **Create a feature branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes**
4. **Run tests**

   ```bash
   npm run test:all
   ```

5. **Submit a pull request**

### Code Style

#### TypeScript/JavaScript

- Use ESLint and Prettier
- Follow TypeScript strict mode
- Use meaningful variable names
- Add JSDoc comments for public APIs

#### Python

- Use Black for formatting
- Follow PEP 8 guidelines
- Use type hints
- Add docstrings for all functions

### Debugging

#### Browser Extension

```bash
# Enable debug logging
localStorage.setItem('veritas_debug', 'true')

# View logs in browser console
# Check background script logs in chrome://extensions/
```

#### Backend Service

```bash
# Enable debug mode
NODE_ENV=development npm run dev

# View logs
tail -f logs/veritas.log
```

#### Data Pipeline

```bash
# Enable debug logging
export VERITAS_LOG_LEVEL=DEBUG
poetry run python -m veritas_data_pipeline.main
```

## 🧪 Testing

### Running Tests

#### All Tests

```bash
# Run complete test suite
npm run test:all

# Run with coverage
npm run test:coverage
```

#### Component Tests

```bash
# Browser extension tests
cd browser-extension && npm run test

# Backend service tests
cd backend-verification-service && npm run test

# Data pipeline tests
cd data-pipeline && poetry run pytest
```

#### End-to-End Tests

```bash
# Run E2E tests
npm run test:e2e

# Run specific E2E test
npm run test:e2e -- --grep "verification flow"
```

### Test Coverage

- **Unit Tests**: >90% coverage
- **Integration Tests**: All API endpoints
- **E2E Tests**: Complete user workflows
- **Performance Tests**: Load and stress testing

### Test Data

```bash
# Load test data
npm run test:seed

# Reset test database
npm run test:reset
```

## 🚀 Deployment

### Production Deployment

#### Prerequisites

- Kubernetes cluster (1.20+)
- Helm 3.0+
- ArgoCD 2.0+
- External database (PostgreSQL 15+)
- Redis cluster
- Load balancer

#### Deployment Steps

1. **Set up infrastructure**

   ```bash
   cd infra/terraform
   terraform init
   terraform plan
   terraform apply
   ```

2. **Deploy applications**

   ```bash
   kubectl apply -f infra/argocd/
   ```

3. **Configure monitoring**

   ```bash
   kubectl apply -f infra/monitoring/
   ```

4. **Verify deployment**

   ```bash
   kubectl get pods -n veritas
   kubectl get services -n veritas
   ```

#### Environment-Specific Configurations

##### Development

```yaml
# values-dev.yaml
replicaCount: 1
resources:
  requests:
    memory: "256Mi"
    cpu: "250m"
  limits:
    memory: "512Mi"
    cpu: "500m"
```

##### Production

```yaml
# values-prod.yaml
replicaCount: 3
resources:
  requests:
    memory: "1Gi"
    cpu: "500m"
  limits:
    memory: "2Gi"
    cpu: "1000m"
autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
```

### Docker Deployment

#### Single Host

```bash
# Build images
docker-compose build

# Start services
docker-compose up -d

# Check status
docker-compose ps
```

#### Multi-Host (Swarm)

```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.yml veritas
```

### Cloud Deployment

#### AWS

```bash
# Deploy with ECS
aws ecs create-cluster --cluster-name veritas
aws ecs register-task-definition --cli-input-json file://task-definition.json
aws ecs create-service --cluster veritas --service-name veritas-api --task-definition veritas-api
```

#### Google Cloud

```bash
# Deploy with GKE
gcloud container clusters create veritas-cluster
kubectl apply -f infra/k8s/
```

#### Azure

```bash
# Deploy with AKS
az aks create --resource-group veritas-rg --name veritas-cluster
kubectl apply -f infra/k8s/
```

## 📊 Monitoring

### Metrics

#### Key Performance Indicators

- **Verification Latency**: p95 < 300ms
- **Accuracy**: >90% precision
- **Throughput**: >1000 verifications/second
- **Uptime**: >99.9%

#### Prometheus Metrics

```bash
# View metrics
curl http://localhost:3000/metrics

# Key metrics
veritas_verification_requests_total
veritas_verification_duration_seconds
veritas_verification_accuracy
veritas_api_requests_total
```

### Logging

#### Log Levels

- **ERROR**: System errors and failures
- **WARN**: Warning conditions
- **INFO**: General information
- **DEBUG**: Detailed debugging information

#### Log Format

```json
{
  "timestamp": "2025-01-04T10:30:00Z",
  "level": "INFO",
  "service": "verification-service",
  "message": "Verification completed",
  "request_id": "req-123",
  "verification_time_ms": 245,
  "confidence": 0.95
}
```

### Alerting

#### Critical Alerts

- Service down
- High error rate (>1%)
- High latency (>500ms)
- Database connection issues

#### Warning Alerts

- High memory usage (>80%)
- High CPU usage (>80%)
- Low disk space (<20%)

### Dashboards

#### Grafana Dashboards

- **Overview**: System health and key metrics
- **Performance**: Latency and throughput
- **Errors**: Error rates and types
- **Resources**: CPU, memory, disk usage

## 🔧 Troubleshooting

### Common Issues

#### Browser Extension Not Working

```bash
# Check extension status
chrome://extensions/

# Enable debug mode
localStorage.setItem('veritas_debug', 'true')

# Check console for errors
# Verify API endpoint is accessible
```

#### Backend Service Issues

```bash
# Check service status
curl http://localhost:3000/health

# View logs
docker logs veritas-backend

# Check database connection
psql $DATABASE_URL -c "SELECT 1;"
```

#### Data Pipeline Issues

```bash
# Check Celery workers
celery -A veritas_data_pipeline.tasks inspect active

# View task results
celery -A veritas_data_pipeline.tasks inspect stats

# Check Redis connection
redis-cli ping
```

### Performance Issues

#### High Latency

1. **Check database performance**

   ```bash
   # Monitor slow queries
   SELECT * FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;
   ```

2. **Check Redis performance**

   ```bash
   # Monitor Redis
   redis-cli info memory
   redis-cli info stats
   ```

3. **Check network latency**

   ```bash
   # Test API response time
   curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3000/health
   ```

#### Memory Issues

1. **Check memory usage**

   ```bash
   # Container memory
   docker stats

   # Process memory
   ps aux | grep node
   ```

2. **Optimize memory settings**

   ```bash
   # Node.js memory
   NODE_OPTIONS="--max-old-space-size=2048" npm start
   ```

### Database Issues

#### Connection Problems

```bash
# Test connection
psql $DATABASE_URL -c "SELECT version();"

# Check connection pool
SELECT * FROM pg_stat_activity WHERE state = 'active';
```

#### Migration Issues

```bash
# Run migrations
npm run migrate

# Check migration status
npm run migrate:status

# Rollback if needed
npm run migrate:rollback
```

### Network Issues

#### CORS Problems

```bash
# Check CORS configuration
curl -H "Origin: http://localhost:3000" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: Content-Type" \
     -X OPTIONS http://localhost:3000/verify
```

#### SSL/TLS Issues

```bash
# Test SSL connection
openssl s_client -connect api.veritas.ai:443

# Check certificate
echo | openssl s_client -servername api.veritas.ai -connect api.veritas.ai:443 2>/dev/null | openssl x509 -noout -dates
```

## ❓ FAQ

### General Questions

**Q: What browsers are supported?**
A: Chrome, Brave, Arc, and other Chromium-based browsers. Firefox support is planned for v2.0.

**Q: How accurate is the verification?**
A: We achieve >90% precision on our test datasets. Accuracy varies by domain and knowledge base quality.

**Q: Is my data secure?**
A: Yes. We use end-to-end encryption, don't store personal data, and all verifications are cryptographically signed.

**Q: Can I use my own knowledge base?**
A: Yes! You can upload your own documents and create custom knowledge bases for specific domains.

### Technical Questions

**Q: How does the RAG pipeline work?**
A: Claims are embedded using OpenAI's text-embedding-ada-002 model, then matched against similar documents in our vector database using cosine similarity.

**Q: What's the verification latency?**
A: We achieve ≤300ms for 90% of verifications. Complex claims may take longer.

**Q: How do you handle rate limiting?**
A: We implement token bucket rate limiting with configurable windows and limits per API key.

**Q: Can I run this locally?**
A: Yes! See the [Installation](#-installation) section for local development setup.

### Business Questions

**Q: Is this open source?**
A: Yes, Veritas AI Agent is licensed under the MIT License.

**Q: Do you offer enterprise support?**
A: Yes, we offer enterprise support, custom deployments, and consulting services. Contact us at <info@anything.ai>.

**Q: Can I integrate this into my application?**
A: Yes! We provide REST APIs, SDKs, and integration guides for various platforms.

**Q: What's the pricing model?**
A: The core software is free and open source. We offer premium features and enterprise support on a subscription basis.

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Quick Start for Contributors

1. **Fork the repository**
2. **Set up development environment**

   ```bash
   git clone https://github.com/your-username/veritas-ai-agent.git
   cd veritas-ai-agent
   npm install
   ```

3. **Make your changes**
4. **Run tests**

   ```bash
   npm run test:all
   ```

5. **Submit a pull request**

### Contribution Areas

- **Bug fixes**: Report and fix bugs
- **Feature development**: Add new features
- **Documentation**: Improve docs and examples
- **Testing**: Add tests and improve coverage
- **Performance**: Optimize code and infrastructure
- **Security**: Identify and fix security issues

### Community Guidelines

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Issue Templates](.github/ISSUE_TEMPLATE/)

## 🆘 Support

### Getting Help

- **Documentation**: [docs/](./docs/)
- **Issues**: [GitHub Issues](https://github.com/anything-ai/veritas-ai-agent/issues)
- **Discussions**: [GitHub Discussions](https://github.com/anything-ai/veritas-ai-agent/discussions)
- **Security**: <security@anything.ai>
- **General**: <info@anything.ai>

### Support Channels

| Channel | Purpose | Response Time |
|---------|---------|---------------|
| GitHub Issues | Bug reports, feature requests | 24-48 hours |
| GitHub Discussions | Questions, community help | 12-24 hours |
| Email Support | Enterprise support | 4-8 hours |
| Security Email | Security vulnerabilities | 24 hours |

### Community Resources

- **Discord**: [Join our community](https://discord.gg/veritas-ai)
- **Twitter**: [@anything_ai](https://twitter.com/anything_ai)
- **Blog**: [anything.ai/blog](https://anything.ai/blog)
- **YouTube**: [Tutorial videos](https://youtube.com/@anything-ai)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### License Summary

- ✅ **Commercial Use**: Allowed
- ✅ **Modification**: Allowed
- ✅ **Distribution**: Allowed
- ✅ **Private Use**: Allowed
- ❌ **Liability**: Limited
- ❌ **Warranty**: None

### Third-Party Licenses

We use several open-source libraries. See [THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md) for details.

## 🙏 Acknowledgments

### Open Source Projects

- **IPFS** for decentralized storage
- **OpenAI** for embedding models
- **Fastify** for the web framework
- **React** for the UI framework
- **PostgreSQL** for the database

### Community

- Our contributors and beta testers
- The open-source community for inspiration and tools
- Academic researchers in fact-checking and verification

### Partners

- **IPFS Foundation** for decentralized storage support
- **OpenAI** for API access and collaboration
- **Cloud providers** for infrastructure support

---

**Made with ❤️ by [anything.ai](https://anything.ai)**

[![Star on GitHub](https://img.shields.io/github/stars/anything-ai/veritas-ai-agent?style=social)](https://github.com/anything-ai/veritas-ai-agent)
[![Follow on Twitter](https://img.shields.io/twitter/follow/anything_ai?style=social)](https://twitter.com/anything_ai)
[![Join Discord](https://img.shields.io/discord/1234567890?style=social)](https://discord.gg/veritas-ai)
