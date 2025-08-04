# FHIR Canonical Manager Documentation

## Overview

FHIR Canonical Manager (FCM) is a high-performance TypeScript/JavaScript library and CLI tool for managing and resolving FHIR resources by their canonical URLs. It provides efficient indexing, caching, and resolution of FHIR packages from NPM registries.

## Documentation Structure

- **[Architecture](./architecture.md)** - System design, components, and data flow
- **[Core API](./api-reference.md)** - Detailed API documentation with examples
- **[CLI Reference](./cli-reference.md)** - Command-line interface documentation
- **[Implementation Details](./implementation.md)** - Deep dive into core functionality
- **[Package Management](./package-management.md)** - How packages are installed and indexed
- **[Search System](./search-system.md)** - Smart search implementation and usage
- **[Testing Guide](./testing.md)** - Testing approach and utilities

## Quick Links

### Core Features
- High-performance resource resolution using canonical URLs
- Smart search with abbreviation support
- Efficient caching with automatic invalidation
- Support for both Bun and npm package managers
- TypeScript-first with full type safety

### Key Components
- `CanonicalManager` - Main API interface ([src/index.ts:674-986](../src/index.ts))
- CLI Commands - Interactive command-line tools ([src/cli/](../src/cli/))
- Cache System - Persistent indexing and caching ([src/index.ts:260-341](../src/index.ts))

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