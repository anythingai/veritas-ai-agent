# Contributing to Veritas AI Agent

Thank you for your interest in contributing to Veritas AI Agent! This document provides guidelines and information for contributors.

## Table of Contents

- [Contributing to Veritas AI Agent](#contributing-to-veritas-ai-agent)
  - [Table of Contents](#table-of-contents)
  - [Code of Conduct](#code-of-conduct)
  - [Getting Started](#getting-started)
    - [Prerequisites](#prerequisites)
    - [Development Setup](#development-setup)
  - [Project Structure](#project-structure)
  - [Making Changes](#making-changes)
    - [Branch Naming Convention](#branch-naming-convention)
    - [Commit Message Format](#commit-message-format)
    - [Code Style](#code-style)
      - [JavaScript/TypeScript](#javascripttypescript)
      - [Python](#python)
  - [Testing](#testing)
    - [Running Tests](#running-tests)
    - [Writing Tests](#writing-tests)
  - [Pull Request Process](#pull-request-process)
    - [Pull Request Template](#pull-request-template)
  - [Release Process](#release-process)
    - [Versioning](#versioning)
    - [Creating a Release](#creating-a-release)
  - [Community](#community)
    - [Getting Help](#getting-help)
    - [Communication Channels](#communication-channels)
    - [Recognition](#recognition)
  - [License](#license)

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

### Prerequisites

- **Node.js 18+** (for browser extension and backend service)
- **Python 3.10+** (for data pipeline)
- **Docker** (for containerized development)
- **Git**

### Development Setup

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/your-username/veritas-ai-agent.git
   cd veritas-ai-agent
   ```

2. **Set up browser extension**

   ```bash
   cd browser-extension
   npm install
   npm run dev
   ```

3. **Set up backend service**

   ```bash
   cd backend-verification-service
   npm install
   npm run dev
   ```

4. **Set up data pipeline**

   ```bash
   cd data-pipeline
   poetry install
   poetry run python -m veritas_data_pipeline.main
   ```

## Project Structure

```
veritas-ai-agent/
├── browser-extension/          # Chrome extension for fact verification
├── backend-verification-service/ # REST API and verification logic
├── data-pipeline/             # Document ingestion and embedding
├── infra/                     # Infrastructure as Code (Terraform, K8s)
├── docs/                      # Documentation
├── tests/                     # End-to-end tests
└── scripts/                   # Utility scripts
```

## Making Changes

### Branch Naming Convention

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring
- `test/description` - Test additions or improvements

### Commit Message Format

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Examples:

- `feat(browser-extension): add dark mode support`
- `fix(backend): resolve memory leak in verification service`
- `docs: update API documentation`

### Code Style

#### JavaScript/TypeScript

- Use ESLint and Prettier for formatting
- Follow TypeScript strict mode
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

#### Python

- Use Black for code formatting
- Follow PEP 8 style guidelines
- Use type hints for all functions
- Add docstrings for all public functions

## Testing

### Running Tests

**Browser Extension:**

```bash
cd browser-extension
npm run test
npm run test:coverage
```

**Backend Service:**

```bash
cd backend-verification-service
npm run test
npm run test:coverage
```

**Data Pipeline:**

```bash
cd data-pipeline
poetry run pytest tests/
poetry run pytest tests/ --cov=src
```

### Writing Tests

- Write unit tests for all new functionality
- Aim for >80% code coverage
- Use descriptive test names
- Mock external dependencies
- Test both success and error cases

## Pull Request Process

1. **Create a feature branch** from `main`
2. **Make your changes** following the coding standards
3. **Write tests** for new functionality
4. **Update documentation** if needed
5. **Run the full test suite** locally
6. **Create a pull request** with a clear description

### Pull Request Template

```markdown
## Description
Brief description of the changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

## Release Process

### Versioning

We use [Semantic Versioning](https://semver.org/) (MAJOR.MINOR.PATCH):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Creating a Release

1. **Update version numbers** in all package.json and pyproject.toml files
2. **Update CHANGELOG.md** with release notes
3. **Create a git tag** with the version number
4. **Push the tag** to trigger the release workflow

```bash
git tag v1.2.0
git push origin v1.2.0
```

## Community

### Getting Help

- **Issues**: Use GitHub Issues for bug reports and feature requests
- **Discussions**: Use GitHub Discussions for questions and general discussion
- **Security**: Report security issues to <security@anything.ai>

### Communication Channels

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: General questions and community discussion
- **Email**: <info@anything.ai> for business inquiries

### Recognition

Contributors will be recognized in:

- Release notes
- Contributors section of README
- Project documentation

## License

By contributing to Veritas AI Agent, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Veritas AI Agent! 🚀
