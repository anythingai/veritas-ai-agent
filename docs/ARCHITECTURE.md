# Veritas AI Agent – Architecture

## Components

### 1. Browser Extension

- Manifest V3, Chrome/Brave/Arc
- Content script: DOM detection, badge injection, tooltip
- IPC: postMessage to background, REST to backend
- Security: CSP, host_permissions, no unsafe-eval

### 2. Backend Verification Service

- REST API: POST /verify
- RAG pipeline: embedding, vector DB, re-ranking, fallback
- Confidence rules, rate limiting, horizontal scaling
- PostgreSQL for metadata, vector DB for embeddings
- IPFS pinning service
- gRPC mesh, Kafka for events

### 3. Data Pipeline

- Ingestion: PDF, DOCX, TXT via Apache Tika
- Chunking, embedding, vector DB storage
- IPFS pinning, CDC with Debezium

### 4. Infrastructure

- Docker, K8s, Terraform, ArgoCD
- Prometheus, Grafana, Loki, PagerDuty

## Data Flow

1. User submits claim via extension
2. Extension sends claim to backend
3. Backend embeds claim, searches vector DB
4. Retrieves citations, computes confidence
5. Returns status and citations to extension
6. Extension displays badge and tooltip

## Technology Choices

- Frontend: TypeScript, React (for popup/options)
- Backend: Node.js (Fastify/Express) or Python (FastAPI)
- Vector DB: PGVector or Elasticsearch
- Embeddings: OpenAI or Instructor-XL
- IPFS: js-ipfs or go-ipfs
- Infra: K8s, Terraform, ArgoCD
- CI/CD: GitHub Actions

---

See PRD for full requirements.
