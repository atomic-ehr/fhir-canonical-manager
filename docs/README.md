# FHIR Canonical Manager Documentation

## Overview

FHIR Canonical Manager (FCM) is a high-performance TypeScript/JavaScript library and CLI tool for managing and resolving FHIR resources by their canonical URLs. It provides efficient indexing, caching, and resolution of FHIR packages from NPM registries.

## 🚀 Recent Updates

- **Modular Architecture** - Refactored from monolithic to component-based architecture (ADR-003)
- **Comprehensive Testing** - 128 tests including 88 unit tests across all modules
- **Full TypeScript Support** - Zero TypeScript errors with strict mode
- **Smart Search** - Enhanced search with abbreviation expansion

## Documentation Structure

- **[Architecture](./architecture.md)** - Modular system design and components
- **[Core API](./api-reference.md)** - Detailed API documentation with examples
- **[CLI Reference](./cli-reference.md)** - Command-line interface documentation
- **[Implementation Details](./implementation.md)** - Deep dive into modular implementation
- **[Testing Guide](./testing.md)** - Comprehensive testing approach with unit and integration tests

## Quick Links

### Core Features
- High-performance resource resolution using canonical URLs
- Smart search with abbreviation support
- Efficient caching with automatic invalidation
- Support for both Bun and npm package managers
- TypeScript-first with full type safety
- Modular architecture for better maintainability

### Module Structure
```
src/
├── types/       - Type definitions and interfaces
├── reference/   - Reference ID management
├── cache/       - Caching layer with persistence
├── fs/          - File system utilities
├── scanner/     - Package scanning and indexing
├── resolver/    - URL resolution logic
├── search/      - Smart search functionality
├── package/     - Package installation
├── manager/     - Main orchestration
└── cli/         - Command-line interface
```

## Getting Started

### Installation
```bash
npm install @atomic-ehr/fhir-canonical-manager
# or
bun add @atomic-ehr/fhir-canonical-manager
```

### Basic Usage
```typescript
import { CanonicalManager } from '@atomic-ehr/fhir-canonical-manager';

const manager = CanonicalManager({
  packages: ['hl7.fhir.r4.core@4.0.1'],
  workingDir: './fhir-cache'
});

await manager.init();
const patient = await manager.resolve('http://hl7.org/fhir/StructureDefinition/Patient');
```

### CLI Usage
```bash
# Initialize packages
fcm init hl7.fhir.r4.core

# Search for resources
fcm search str def pati  # Finds StructureDefinition/Patient

# Resolve a resource
fcm resolve http://hl7.org/fhir/StructureDefinition/Patient
```