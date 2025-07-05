# Veritas AI Agent – Product Requirements Document (prd.md)

**Project Name:** Veritas AI Agent\
**Version:** 1.1 – Production Release\
**Status:** In Development\
**Authors:** anything.ai
**Last Updated:** 04 Jul 2025

---

## 1  Vision & Problem Statement

### 1.1  Problem

Generative AI models routinely output plausible but false information (“hallucinations”), breaking user trust in critical domains such as research, business intelligence, and education.

### 1.2  Vision

Veritas provides a real‑time trust layer for AI by grounding large‑language‑model (LLM) output in verifiable, cryptographically‑signed source documents stored on IPFS. As a browser extension it overlays fact‑checking cues directly inside popular AI chat UIs, transforming LLMs from creative storytellers into trusted assistants.

## 2  Goals & Non‑Goals

| Goals                                                                         | Non‑Goals                                |
| ----------------------------------------------------------------------------- | ---------------------------------------- |
| •  ≤300 ms factual verification for ≥90 % of claims on supported pages        |                                          |
| •  End‑to‑end cryptographic verifiability via IPFS CIDs                       |                                          |
| •  Seamless extension install & auto‑update across Chrome‑compatible browsers |                                          |
| •  Modular backend ready for multitenant SaaS                                 | •  General misinformation classification |
| •  Real‑time media fact‑checking (images, video)                              |                                          |
| •  Cross‑browser (Firefox, Safari) until post‑v1                              |                                          |

## 3  Target Users & Personas

### 3.1  Primary Persona – *The Researcher*

*Students, academics, market analysts.* Needs: rock‑solid citations, instant provenance, domain‑specific KBs.

### 3.2  Secondary Personas

*Developers* and *Enterprise Compliance Officers*.

## 4  User Stories (MoSCoW‑Prioritised)

| ID     | As a…      | I want…                                                 | So that…                              | Priority |
| ------ | ---------- | ------------------------------------------------------- | ------------------------------------- | -------- |
| US‑001 | Researcher | to install the extension with one click                 | I can start verifying immediately     | Must     |
| US‑002 | Researcher | visual indicators (✔︎/✖︎/⟳) next to each claim          | I can instantly judge trustworthiness | Must     |
| US‑003 | Researcher | to inspect a citation popup showing snippet + IPFS link | I can audit the source myself         | Must     |
| US‑004 | Researcher | to switch knowledge bases                               | verification stays domain‑relevant    | Should   |
| US‑005 | Developer  | REST/GraphQL endpoints                                  | integrate Veritas in CI pipelines     | Could    |

## 5  Functional Requirements

### 5.1  Browser Extension (Frontend)

- **FR‑A1 Platform Support:** Manifest V3 WebExtension; Chrome, Brave, Arc.
- **FR‑A2 DOM Detection:** Content script waits for ChatGPT answer completion, then traverses `<div[data‑scroll‑target] > p, li` nodes.
- **FR‑A3 Icons:** `<span class="veritas‑badge">` with three states—Pending (spinner), Verified (green), Unverified (red).
- **FR‑A4 Tooltip:** On hover/click display snippet, file name, and `https://ipfs.io/ipfs/{CID}` link.
- **FR‑A5 IPC:** `postMessage` channel to background → backend REST `/verify`.
- **FR‑A6 Security Hardening:** `host_permissions` scoped to `https://chat.openai.com/*`; no `unsafe‑eval`; CSP upgrade.

### 5.2  Verification Service (Backend)

- **API Surface:** `POST /verify` → returns JSON `{status, confidence, citations[]}`.
- **RAG Pipeline:**
  1. Embed claim with OpenAI or local instructor‑XL model.
  2. Vector DB similarity search (PGVector / Elasticsearch).
  3. Optional re‑ranking with cross‑encoder.
  4. Fallback to general LLM if KB hit < 0.8.
- **Confidence Rules:** ≥0.8 → Verified; 0.5–0.79 → Unverified; <0.5 → Unknown.
- **Rate‑Limit:** 50 req/s per API key.

### 5.3  Data Pipeline

- **Ingestion:** Users upload PDFs, DOCX, TXT → extracted via Apache Tika → chunk (≈500 tokens, 20 overlap).
- **Embedding:** Offline worker generates embeddings, stores in Vector DB.
- **IPFS Pinning:** Hash file → CID; store CID in `source_documents` table.
- **Schema Change‑Data‑Capture:** Debezium emits updates to analytics.

## 6  Non‑Functional Requirements

- **Security:** Adhere to OWASP Extension Cheat Sheet; least‑privilege; no remote code eval.
- **Performance:** p95 extension UI latency ≤ 16 ms; backend p95 latency ≤ 300 ms.
- **Reliability:** SLA 99.9 % monthly uptime; graceful degradation to “Pending”.
- **Scalability:** Horizontal pods (K8s) auto‑scale to 10k concurrent verifications.
- **Accessibility:** All visual indicators meet WCAG 2.1 AA contrast.
- **Privacy & Compliance:** Chrome Web Store policies 2025, GDPR, SOC2.

## 7  System Architecture

``` text
Browser Extension → HTTPS → API Gateway → Verification Service (LLM & Vector DB) ↔ Postgres
                                                    ↘ IPFS Pinning Service
```

- Use gRPC internal mesh; Kafka for events.

## 8  Data Model

### 8.1 `source_documents`

| column      | type        | notes           |
| ----------- | ----------- | --------------- |
| id          | UUID        | PK              |
| cid         | text        | IPFS CID        |
| title       | text        | file name       |
| mime\_type  | text        | …               |
| vector\_id  | bigint      | FK to vector DB |
| created\_at | timestamptz |                 |

### 8.2 `verification_requests`

| column      | type        | notes                       |
| ----------- | ----------- | --------------------------- |
| id          | UUID        | PK                          |
| claim\_text | text        | raw claim                   |
| confidence  | numeric     | 0–1                         |
| status      | enum        | VERIFIED/UNVERIFIED/UNKNOWN |
| doc\_ids    | uuid[]      | citations                   |
| created\_at | timestamptz |                             |

## 9  UI & Design System (Claymorphism)

- Pastel palette: **Lavender #E6E6FA**, **Mint #98FB98**, **BabyBlue #87CEEB**, **Peach #FFDAB9**.
- `border‑radius: 20px; box‑shadow: inset 4px 4px 6px rgba(0,0,0,.1), 2px 2px 4px rgba(0,0,0,.07);`
- Use `prefers‑color‑scheme` to switch to darker pastels for dark mode.
- Micro‑interaction: badge jiggle via `@keyframes squish`.

## 10  CI/CD & Deployment

| Stage   | Job                                 | Tooling                                |
| ------- | ----------------------------------- | -------------------------------------- |
| Build   | Lint, type‑check, Vitest            | GitHub Actions                         |
| Package | `pnpm run build-extension` → `.zip` | GitHub Action `chrome-webstore-upload` |
| Backend | Docker build → push to GHCR         | Argo CD                                |
| Infra   | Terraform apply                     | prod/stage                             |
| Release | Semantic version tagging            |                                        |

## 11  Monitoring & Observability

- Metrics: Prometheus; Grafana dashboards for latency, verification accuracy.
- Logs: Loki; trace IDs propagated from extension.
- Alerts: PagerDuty if error rate > 1 % for 5 min.

## 12  Acceptance Criteria & KPIs

- ≥90 % precision on internal fact‑checking test‑set.
- ≤0.1 % extension‑caused console errors per MAU.
-
  > 30 % week‑over‑week retention of active researchers.

## 13  Risks & Mitigations

| Risk                 | Impact | Mitigation                              |
| -------------------- | ------ | --------------------------------------- |
| Knowledge base drift | Medium | nightly re‑embedding job                |
| Chrome policy change | High   | monitor DevRel feed, auto‑CI regression |
| IPFS gateway outage  | Low    | multi‑gateway fallback                  |

## 14  Roadmap (Post v1.1)

- Firefox port (MV3 shim)
- Image fact‑checking via CLIP embeddings
- Enterprise admin console & SCIM provisioning

## 15  Glossary

- **CID** – Content Identifier hash for IPFS objects.
- **RAG** – Retrieval‑Augmented Generation.

---

© 2025 anything.ai
