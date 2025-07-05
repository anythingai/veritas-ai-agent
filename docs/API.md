# API Documentation

## Backend Verification Service

### POST /verify

- **Request:**
  - `claim_text` (string): The claim to verify.
- **Response:**
  - `status` (string): VERIFIED, UNVERIFIED, or UNKNOWN
  - `confidence` (number): 0–1
  - `citations` (array): List of source document references

## Data Pipeline

### POST /ingest

- **Request:**
  - File upload (PDF, DOCX, TXT)
- **Response:**
  - `status` (string): PENDING, COMPLETE, or ERROR
  - `cid` (string, optional): IPFS CID if successful
