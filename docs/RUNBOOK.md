# Operational Runbook

## Deployment

- Use ArgoCD to sync applications (backend, data pipeline, monitoring).
- Use Terraform to manage cloud infra (Postgres, K8s, monitoring stack).
- CI/CD pipeline builds, tests, and deploys all services.

## Monitoring

- Prometheus scrapes /metrics endpoints for backend and data pipeline.
- Grafana dashboards visualize latency, request rates, and error rates.
- Loki aggregates logs; trace IDs are propagated from extension to backend.
- PagerDuty alerts on error rate >1% for 5min.

## Incident Response

- Check Grafana and Loki for error spikes or latency issues.
- Use ArgoCD to roll back to previous deployment if needed.
- Reference PRD for SLA, SLO, and escalation policies.
