# Testing Guide

## Overview

This project uses Vitest (JS/TS) and pytest (Python) for unit and integration tests. E2E tests are recommended for extension and backend flows.

## Running Tests

- **Browser Extension:**
  - `pnpm test` (runs Vitest)
- **Backend:**
  - `pnpm test` (runs Vitest)
- **Data Pipeline:**
  - `poetry run pytest`

## Coverage

- CI enforces test coverage gates for all modules.
- Add new tests for all new features and bugfixes.

## E2E Testing

- Use Playwright or Selenium for browser extension E2E tests.
- Use HTTP clients for backend/data pipeline E2E tests.
