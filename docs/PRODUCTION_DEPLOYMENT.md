# Veritas AI Agent - Production Deployment Guide

**Version:** 1.1.0  
**Last Updated:** January 2025  
**Status:** Production Ready

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Infrastructure Setup](#infrastructure-setup)
4. [Database Setup](#database-setup)
5. [Secrets Management](#secrets-management)
6. [Application Deployment](#application-deployment)
7. [Monitoring Setup](#monitoring-setup)
8. [Load Balancing](#load-balancing)
9. [Backup Configuration](#backup-configuration)
10. [Security Hardening](#security-hardening)
11. [Maintenance Procedures](#maintenance-procedures)
12. [Troubleshooting](#troubleshooting)
13. [Performance Optimization](#performance-optimization)
14. [Compliance](#compliance)
15. [Support and Escalation](#support-and-escalation)

## Overview

This guide provides comprehensive instructions for deploying the Veritas AI Agent system to production. The system consists of:

- **Backend Verification Service**: Node.js/TypeScript API service
- **Data Pipeline**: Python FastAPI service for document processing
- **Browser Extension**: Chrome WebExtension for client-side verification
- **Monitoring Stack**: Prometheus, Grafana, Loki, and AlertManager
- **Infrastructure**: Kubernetes cluster with Terraform-managed resources

### System Architecture

```
Internet → Load Balancer → Ingress Controller → Kubernetes Cluster
                                    ↓
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│   Backend API   │  Data Pipeline  │   Monitoring    │   Database      │
│   (Node.js)     │   (Python)      │   (Prometheus)  │   (PostgreSQL)  │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┘
                                    ↓
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│   Redis Cache   │   IPFS Gateway  │   Vector DB     │   Backup Store  │
│   (Redis)       │   (IPFS)        │   (PGVector)    │   (GCS)         │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┘
```

## Prerequisites

### Infrastructure Requirements

- **Kubernetes Cluster**: v1.25+ with at least 3 nodes
- **CPU**: 8+ cores per node
- **Memory**: 32GB+ RAM per node
- **Storage**: 500GB+ SSD storage per node
- **Network**: 1Gbps+ bandwidth
- **Load Balancer**: Cloud load balancer (GCP, AWS, or Azure)

### Software Requirements

- **kubectl**: v1.25+
- **helm**: v3.10+
- **terraform**: v1.5+
- **docker**: v20.10+
- **gcloud/aws-cli/az-cli**: For cloud provider access

### External Dependencies

- **OpenAI API**: For embedding generation and LLM fallback
- **IPFS Gateway**: For document storage and retrieval
- **Cloud Storage**: For backup storage (GCS, S3, or Azure Blob)
- **Domain Name**: For production URLs
- **SSL Certificate**: For HTTPS termination

## Infrastructure Setup

### 1. Cloud Provider Configuration

#### Google Cloud Platform (Recommended)

```bash
# Set up GCP project
gcloud config set project veritas-production
gcloud auth application-default login

# Enable required APIs
gcloud services enable container.googleapis.com
gcloud services enable compute.googleapis.com
gcloud services enable storage.googleapis.com
gcloud services enable dns.googleapis.com
```

#### AWS

```bash
# Configure AWS CLI
aws configure

# Create S3 bucket for Terraform state
aws s3 mb s3://veritas-terraform-state
aws s3api put-bucket-versioning --bucket veritas-terraform-state --versioning-configuration Status=Enabled
```

### 2. Terraform Infrastructure Deployment

```bash
# Navigate to infrastructure directory
cd infra/terraform

# Initialize Terraform
terraform init

# Plan deployment
terraform plan -var-file=production.tfvars

# Apply infrastructure
terraform apply -var-file=production.tfvars
```

### 3. Kubernetes Cluster Setup

```bash
# Get cluster credentials
gcloud container clusters get-credentials veritas-cluster --region us-central1

# Verify cluster access
kubectl cluster-info
kubectl get nodes
```

### 4. Namespace Creation

```bash
# Create namespaces
kubectl apply -f infra/k8s/namespaces.yaml

# Verify namespaces
kubectl get namespaces | grep veritas
```

## Database Setup

### 1. PostgreSQL Deployment

```bash
# Deploy PostgreSQL with Helm
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

helm install veritas-postgres bitnami/postgresql \
  --namespace database \
  --set auth.postgresPassword=VERITAS_DB_PASSWORD \
  --set auth.database=veritas \
  --set primary.persistence.size=100Gi \
  --set primary.resources.requests.memory=4Gi \
  --set primary.resources.requests.cpu=2 \
  --set primary.resources.limits.memory=8Gi \
  --set primary.resources.limits.cpu=4
```

### 2. Database Schema Initialization

```bash
# Apply database schema
kubectl apply -f infra/postgres/schema.sql

# Verify schema
kubectl exec -it veritas-postgres-0 -n database -- psql -U postgres -d veritas -c "\dt"
```

### 3. Vector Extension Setup

```bash
# Install pgvector extension
kubectl exec -it veritas-postgres-0 -n database -- psql -U postgres -d veritas -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Verify extension
kubectl exec -it veritas-postgres-0 -n database -- psql -U postgres -d veritas -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

## Secrets Management

### 1. Create Kubernetes Secrets

```bash
# Create secrets namespace
kubectl create namespace secrets

# Database credentials
kubectl create secret generic database-credentials \
  --namespace secrets \
  --from-literal=username=postgres \
  --from-literal=password=VERITAS_DB_PASSWORD \
  --from-literal=url=postgresql://postgres:VERITAS_DB_PASSWORD@veritas-postgres.database.svc.cluster.local:5432/veritas

# OpenAI API key
kubectl create secret generic openai-api-key \
  --namespace secrets \
  --from-literal=api-key=YOUR_OPENAI_API_KEY

# IPFS configuration
kubectl create secret generic ipfs-config \
  --namespace secrets \
  --from-literal=gateway-url=https://ipfs.io \
  --from-literal=api-key=YOUR_IPFS_API_KEY

# Cloud storage credentials
kubectl create secret generic cloud-storage-credentials \
  --namespace secrets \
  --from-file=service-account.json=path/to/service-account.json
```

### 2. External Secrets Operator (Optional)

For production environments, consider using External Secrets Operator:

```bash
# Install External Secrets Operator
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --create-namespace

# Configure secret store
kubectl apply -f infra/secrets/secret-store.yaml
kubectl apply -f infra/secrets/external-secrets.yaml
```

## Application Deployment

### 1. Backend Verification Service

```bash
# Build and push Docker image
docker build -t gcr.io/veritas-production/veritas-backend:v1.1.0 backend-verification-service/
docker push gcr.io/veritas-production/veritas-backend:v1.1.0

# Deploy to Kubernetes
kubectl apply -f infra/k8s/backend-deployment.yaml
kubectl apply -f infra/k8s/backend-service.yaml
kubectl apply -f infra/k8s/backend-ingress.yaml

# Verify deployment
kubectl get pods -n veritas -l app=veritas-backend
kubectl logs -n veritas -l app=veritas-backend
```

### 2. Data Pipeline Service

```bash
# Build and push Docker image
docker build -t gcr.io/veritas-production/veritas-data-pipeline:v1.1.0 data-pipeline/
docker push gcr.io/veritas-production/veritas-data-pipeline:v1.1.0

# Deploy to Kubernetes
kubectl apply -f infra/k8s/data-pipeline-deployment.yaml
kubectl apply -f infra/k8s/data-pipeline-service.yaml

# Verify deployment
kubectl get pods -n veritas -l app=veritas-data-pipeline
kubectl logs -n veritas -l app=veritas-data-pipeline
```

### 3. Redis Cache

```bash
# Deploy Redis with Helm
helm install veritas-redis bitnami/redis \
  --namespace cache \
  --set auth.password=VERITAS_REDIS_PASSWORD \
  --set master.persistence.size=50Gi \
  --set master.resources.requests.memory=2Gi \
  --set master.resources.requests.cpu=1 \
  --set master.resources.limits.memory=4Gi \
  --set master.resources.limits.cpu=2
```

### 4. Network Policies

```bash
# Apply network policies for security
kubectl apply -f infra/k8s/network-policies.yaml

# Verify network policies
kubectl get networkpolicies --all-namespaces
```

## Monitoring Setup

### 1. Prometheus Stack

```bash
# Install Prometheus Operator
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --set prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage=100Gi \
  --set grafana.adminPassword=VERITAS_GRAFANA_PASSWORD

# Apply custom Prometheus configuration
kubectl apply -f infra/monitoring/prometheus.yaml
```

### 2. Alerting Rules

```bash
# Apply alerting rules
kubectl apply -f infra/monitoring/alerts.yaml

# Verify alerts
kubectl get prometheusrules -n monitoring
```

### 3. Grafana Dashboards

```bash
# Apply Grafana dashboards
kubectl apply -f infra/monitoring/grafana-dashboard.json

# Access Grafana
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80
```

### 4. Logging with Loki

```bash
# Install Loki stack
helm repo add grafana https://grafana.github.io/helm-charts
helm install loki grafana/loki-stack \
  --namespace monitoring \
  --set loki.persistence.size=50Gi

# Configure log collection
kubectl apply -f infra/monitoring/loki-config.yaml
```

## Load Balancing

### 1. Ingress Controller

```bash
# Install NGINX Ingress Controller
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.replicaCount=3 \
  --set controller.resources.requests.memory=256Mi \
  --set controller.resources.requests.cpu=100m \
  --set controller.resources.limits.memory=512Mi \
  --set controller.resources.limits.cpu=200m
```

### 2. SSL/TLS Configuration

```bash
# Install cert-manager for SSL certificates
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true

# Apply certificate issuer
kubectl apply -f infra/ssl/certificate-issuer.yaml

# Apply certificate
kubectl apply -f infra/ssl/certificate.yaml
```

### 3. Ingress Configuration

```bash
# Apply ingress rules
kubectl apply -f infra/k8s/ingress.yaml

# Verify ingress
kubectl get ingress -n veritas
kubectl describe ingress veritas-ingress -n veritas
```

## Backup Configuration

### 1. Backup Jobs Deployment

```bash
# Deploy backup configuration
kubectl apply -f infra/backup/backup-config.yaml

# Verify backup jobs
kubectl get cronjobs -n backup
kubectl get jobs -n backup
```

### 2. Backup Verification

```bash
# Check backup status
kubectl logs -n backup -l app=backup-job --tail=100

# Verify backup files in cloud storage
gsutil ls gs://veritas-backups/database/$(date +%Y/%m/%d)/
```

### 3. Disaster Recovery Testing

```bash
# Test database restore
kubectl create job --from=cronjob/veritas-database-backup test-restore -n backup

# Monitor restore process
kubectl logs -n backup -l job-name=test-restore
```

## Security Hardening

### 1. Pod Security Standards

```bash
# Apply Pod Security Standards
kubectl apply -f infra/security/pod-security-standards.yaml

# Verify compliance
kubectl get pods -n veritas -o yaml | grep securityContext
```

### 2. RBAC Configuration

```bash
# Apply RBAC rules
kubectl apply -f infra/security/rbac.yaml

# Verify RBAC
kubectl get clusterroles | grep veritas
kubectl get clusterrolebindings | grep veritas
```

### 3. Security Scanning

```bash
# Install Trivy for vulnerability scanning
helm repo add aquasecurity https://aquasecurity.github.io/helm-charts
helm install trivy aquasecurity/trivy \
  --namespace security \
  --create-namespace

# Scan images
trivy image gcr.io/veritas-production/veritas-backend:v1.1.0
```

### 4. Network Security

```bash
# Apply network policies
kubectl apply -f infra/k8s/network-policies.yaml

# Verify network policies
kubectl get networkpolicies --all-namespaces
```

## Maintenance Procedures

### 1. Regular Maintenance Schedule

- **Daily**: Monitor system health and backup status
- **Weekly**: Review logs, update security patches
- **Monthly**: Performance analysis, capacity planning
- **Quarterly**: Security audit, disaster recovery testing

### 2. Rolling Updates

```bash
# Update backend service
kubectl set image deployment/veritas-backend \
  veritas-backend=gcr.io/veritas-production/veritas-backend:v1.1.1 \
  -n veritas

# Monitor rollout
kubectl rollout status deployment/veritas-backend -n veritas
```

### 3. Database Maintenance

```bash
# Database vacuum and analyze
kubectl exec -it veritas-postgres-0 -n database -- psql -U postgres -d veritas -c "VACUUM ANALYZE;"

# Check database size
kubectl exec -it veritas-postgres-0 -n database -- psql -U postgres -d veritas -c "SELECT pg_size_pretty(pg_database_size('veritas'));"
```

### 4. Cache Maintenance

```bash
# Redis memory optimization
kubectl exec -it veritas-redis-master-0 -n cache -- redis-cli -a VERITAS_REDIS_PASSWORD MEMORY PURGE

# Check Redis memory usage
kubectl exec -it veritas-redis-master-0 -n cache -- redis-cli -a VERITAS_REDIS_PASSWORD INFO memory
```

## Troubleshooting

### 1. Common Issues

#### High Memory Usage

```bash
# Check memory usage
kubectl top pods -n veritas
kubectl describe nodes | grep -A 5 "Allocated resources"

# Check for memory leaks
kubectl logs -n veritas -l app=veritas-backend --tail=1000 | grep "memory"
```

#### Database Connection Issues

```bash
# Check database connectivity
kubectl exec -it veritas-backend-xxx -n veritas -- nc -zv veritas-postgres.database.svc.cluster.local 5432

# Check database logs
kubectl logs -n database veritas-postgres-0
```

#### Slow Response Times

```bash
# Check application metrics
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090

# Check slow queries
kubectl exec -it veritas-postgres-0 -n database -- psql -U postgres -d veritas -c "SELECT * FROM pg_stat_activity WHERE state = 'active';"
```

### 2. Log Analysis

```bash
# Collect logs from all services
kubectl logs -n veritas -l app=veritas-backend --tail=1000 > backend-logs.txt
kubectl logs -n veritas -l app=veritas-data-pipeline --tail=1000 > pipeline-logs.txt

# Search for errors
grep -i error backend-logs.txt | tail -20
```

### 3. Performance Diagnostics

```bash
# Check resource usage
kubectl top pods --all-namespaces
kubectl top nodes

# Check network policies
kubectl get networkpolicies --all-namespaces -o yaml
```

## Performance Optimization

### 1. Application Optimization

- **Connection Pooling**: Configure database connection pools
- **Caching Strategy**: Implement Redis caching for frequently accessed data
- **Query Optimization**: Monitor and optimize database queries
- **Load Balancing**: Distribute traffic across multiple instances

### 2. Infrastructure Optimization

- **Resource Limits**: Set appropriate CPU and memory limits
- **Horizontal Scaling**: Configure HPA for automatic scaling
- **Storage Optimization**: Use SSD storage for database and cache
- **Network Optimization**: Optimize network policies and routing

### 3. Monitoring and Tuning

```bash
# Set up performance monitoring
kubectl apply -f infra/monitoring/performance-dashboards.yaml

# Configure resource quotas
kubectl apply -f infra/k8s/resource-quotas.yaml
```

## Compliance

### 1. Data Protection

- **Encryption**: All data encrypted at rest and in transit
- **Access Control**: Role-based access control (RBAC)
- **Audit Logging**: Comprehensive audit trails
- **Data Retention**: Automated data retention policies

### 2. Security Compliance

- **SOC 2**: Implement SOC 2 controls
- **GDPR**: Ensure GDPR compliance for EU users
- **ISO 27001**: Follow ISO 27001 security standards
- **Regular Audits**: Conduct regular security audits

### 3. Monitoring and Reporting

```bash
# Generate compliance reports
kubectl apply -f infra/compliance/compliance-reports.yaml

# Check compliance status
kubectl get compliancechecks -n compliance
```

## Support and Escalation

### 1. Support Levels

- **Level 1**: Basic troubleshooting and monitoring
- **Level 2**: Application and infrastructure issues
- **Level 3**: Complex technical problems and architecture

### 2. Escalation Procedures

1. **Immediate Response** (P0): System down, security breach
2. **High Priority** (P1): Performance degradation, data loss
3. **Medium Priority** (P2): Feature issues, minor bugs
4. **Low Priority** (P3): Enhancement requests, documentation

### 3. Contact Information

- **On-Call Engineer**: +1-XXX-XXX-XXXX
- **System Administrator**: <admin@veritas.ai>
- **Security Team**: <security@veritas.ai>
- **Management Escalation**: <management@veritas.ai>

### 4. Documentation

- **Runbook**: [docs/RUNBOOK.md](RUNBOOK.md)
- **API Documentation**: [docs/API.md](API.md)
- **Architecture**: [docs/ARCHITECTURE.md](ARCHITECTURE.md)
- **Security Audit**: [docs/SECURITY_AUDIT.md](SECURITY_AUDIT.md)

---

## Appendix

### A. Environment Variables

```bash
# Backend Service
DATABASE_URL=postgresql://postgres:password@veritas-postgres.database.svc.cluster.local:5432/veritas
REDIS_URL=redis://veritas-redis-master.cache.svc.cluster.local:6379
OPENAI_API_KEY=your-openai-api-key
IPFS_GATEWAY_URL=https://ipfs.io
LOG_LEVEL=info
NODE_ENV=production

# Data Pipeline
DATABASE_URL=postgresql://postgres:password@veritas-postgres.database.svc.cluster.local:5432/veritas
REDIS_URL=redis://veritas-redis-master.cache.svc.cluster.local:6379
IPFS_GATEWAY_URL=https://ipfs.io
UPLOAD_MAX_SIZE=52428800
LOG_LEVEL=info
```

### B. Health Check Endpoints

- **Backend Health**: `https://api.veritas.ai/health`
- **Data Pipeline Health**: `https://pipeline.veritas.ai/health`
- **Database Health**: `https://api.veritas.ai/health/database`
- **Cache Health**: `https://api.veritas.ai/health/cache`

### C. Monitoring URLs

- **Grafana**: `https://grafana.veritas.ai`
- **Prometheus**: `https://prometheus.veritas.ai`
- **AlertManager**: `https://alerts.veritas.ai`

### D. Backup Verification

```bash
# Verify backup integrity
gsutil ls gs://veritas-backups/database/$(date +%Y/%m/%d)/ | wc -l

# Test backup restore
kubectl create job --from=cronjob/veritas-database-backup test-restore -n backup
```

---

**Note**: This deployment guide should be updated with each release. Always test deployment procedures in a staging environment before applying to production.
