# @atomic-ehr/fhir-canonical-manager

A TypeScript package manager for FHIR resources that provides canonical URL resolution. This library helps you discover, resolve, and manage FHIR packages and their resources through a simple, functional API.

## Features

- 🔍 **Package Discovery** - Automatically scans and indexes FHIR packages from node_modules
- 🎯 **Canonical URL Resolution** - Resolve canonical URLs to specific resource versions
- 📦 **Package Management** - List and filter resources by package
- 🔗 **Stable References** - Deterministic hash-based reference IDs
- 🚀 **Functional Design** - Clean, functional programming style
- 🎭 **Type-Safe** - Full TypeScript support with comprehensive types

## Installation

```bash
bun install @atomic-ehr/fhir-canonical-manager
# or
npm install @atomic-ehr/fhir-canonical-manager
```

## Quick Start

```typescript
import { CanonicalManager } from '@atomic-ehr/fhir-canonical-manager';

// Create a manager instance
const manager = CanonicalManager({
  packagePaths: ['./node_modules'] // Optional, this is the default
});

// Initialize (scans for FHIR packages)
await manager.init();

// Resolve a canonical URL
const patient = await manager.resolve(
  'http://hl7.org/fhir/StructureDefinition/Patient'
);

// Read the full resource
const resource = await manager.read(patient);
console.log(resource.url); // http://hl7.org/fhir/StructureDefinition/Patient

// Clean up when done
await manager.destroy();
```

## Core Interfaces

```typescript
interface Reference {
    id: string; // opaque id - implementation driven
    resourceType: string;
}

interface PackageId {
    name: string;
    version: string;
}

interface IndexEntry extends Reference {
    indexVersion: number;
    kind?: string;
    url?: string;
    type?: string;
    version?: string;
    package?: PackageId;
}

interface Resource extends Reference {
    url?: string;
    version?: string;
    [key: string]: any;
}

interface SourceContext {
    id?: string;
    package?: PackageId;
    url?: string;
    path?: string;
}

interface CanonicalManager {
    init(): Promise<void>;
    destroy(): Promise<void>;
    packages(): Promise<PackageId[]>;
    resolve(canonicalUrl: string, options?: {
        package?: string, 
        version?: string, 
        sourceContext?: SourceContext
    }): Promise<IndexEntry>;
    read(reference: Reference): Promise<Resource>;
    search(params: {
        kind?: string, 
        url?: string, 
        type?: string, 
        version?: string, 
        package?: PackageId
    }): Promise<IndexEntry[]>;
}
```

## API Reference

### `CanonicalManager(config?: Config)`

Creates a new instance of the canonical manager.

```typescript
interface Config {
  packagePaths?: string[]; // Paths to scan for FHIR packages (default: ['./node_modules'])
}
```

### `init(): Promise<void>`

Initializes the manager by scanning configured paths for FHIR packages. Must be called before using other methods.

```typescript
await manager.init();
```

### `destroy(): Promise<void>`

Cleans up resources and clears all caches.

```typescript
await manager.destroy();
```

### `packages(): Promise<PackageId[]>`

Returns a list of all discovered FHIR packages.

```typescript
const packages = await manager.packages();
// [
//   { name: '@hl7/fhir-r4-core', version: '4.0.1' },
//   { name: '@hl7/us-core', version: '3.1.0' }
// ]
```

### `resolve(url: string, options?): Promise<IndexEntry>`

Resolves a canonical URL to an index entry.

```typescript
// Basic resolution
const entry = await manager.resolve(
  'http://hl7.org/fhir/StructureDefinition/Patient'
);

// With package constraint
const entry = await manager.resolve(
  'http://hl7.org/fhir/StructureDefinition/Patient',
  { package: '@hl7/fhir-r4-core' }
);

// With version constraint
const entry = await manager.resolve(
  'http://hl7.org/fhir/StructureDefinition/Patient',
  { version: '4.0.1' }
);
```

Options:
- `package?: string` - Filter by package name
- `version?: string` - Filter by resource version
- `sourceContext?: SourceContext` - Context for relative resolution

### `read(reference: Reference): Promise<Resource>`

Reads the full resource content for a given reference.

```typescript
const entry = await manager.resolve('http://hl7.org/fhir/StructureDefinition/Patient');
const resource = await manager.read(entry);

console.log(resource.resourceType); // "StructureDefinition"
console.log(resource.url); // "http://hl7.org/fhir/StructureDefinition/Patient"
```

### `search(params): Promise<IndexEntry[]>`

Searches for resources matching the given criteria.

```typescript
// Find all StructureDefinitions
const structures = await manager.search({
  type: 'StructureDefinition'
});

// Find resources by kind
const resources = await manager.search({
  kind: 'resource'
});

// Find by URL pattern
const patients = await manager.search({
  url: 'http://hl7.org/fhir/StructureDefinition/Patient'
});

// Filter by package
const usCore = await manager.search({
  package: { name: '@hl7/us-core', version: '3.1.0' }
});

// Combine filters
const r4ValueSets = await manager.search({
  type: 'ValueSet',
  package: { name: '@hl7/fhir-r4-core', version: '4.0.1' }
});
```

Search parameters:
- `kind?: string` - Resource kind (e.g., 'resource', 'datatype', 'primitive')
- `url?: string` - Canonical URL (exact match)
- `type?: string` - Resource type (e.g., 'StructureDefinition', 'ValueSet')
- `version?: string` - Resource version
- `package?: PackageId` - Filter by package

## How It Works

1. **Package Discovery**: The manager scans configured directories (typically `node_modules`) for FHIR packages
2. **Index Processing**: It reads `.index.json` files from each package to build a resource catalog
3. **Reference Generation**: Each resource gets a stable, deterministic ID based on its package and file path
4. **URL Mapping**: Canonical URLs are mapped to their corresponding resources for quick lookup

## FHIR Package Structure

The manager expects FHIR packages to follow the standard structure:

```
package-name/
├── package.json       # Package metadata
├── .index.json       # Resource index
├── StructureDefinition-Patient.json
├── ValueSet-example.json
└── examples/
    ├── .index.json   # Examples index
    └── Patient-example.json
```

## Use Cases

### Resolving Resources in a FHIR Validator

```typescript
const manager = CanonicalManager();
await manager.init();

async function validateResource(resource: any) {
  // Resolve the profile URL
  const profile = await manager.resolve(resource.meta.profile[0]);
  const structureDefinition = await manager.read(profile);
  
  // Use the StructureDefinition for validation
  return validate(resource, structureDefinition);
}
```

### Building a FHIR Resource Explorer

```typescript
// List all available resource types
const structureDefs = await manager.search({
  type: 'StructureDefinition',
  kind: 'resource'
});

// Group by package
const byPackage = structureDefs.reduce((acc, entry) => {
  const pkgName = entry.package?.name || 'unknown';
  acc[pkgName] = acc[pkgName] || [];
  acc[pkgName].push(entry);
  return acc;
}, {});
```

### Finding Package Dependencies

```typescript
// Get all ValueSets from US Core
const usValueSets = await manager.search({
  type: 'ValueSet',
  package: { name: '@hl7/us-core', version: '3.1.0' }
});

// Check which ones reference external URLs
for (const valueSet of usValueSets) {
  const resource = await manager.read(valueSet);
  // Analyze compose.include for external systems
}
```

## CLI Tool

The package includes a command-line search tool:

```bash
# Search by URL pattern
bun tools/search-canonical.ts --url Patient --limit 10

# Find all StructureDefinitions
bun tools/search-canonical.ts --type StructureDefinition

# Search by kind
bun tools/search-canonical.ts --kind resource --limit 20

# Export as JSON
bun tools/search-canonical.ts --type ValueSet --format json > valuesets.json

# Filter by package
bun tools/search-canonical.ts --package @hl7/fhir-r4-core --type CodeSystem
```

## Performance Considerations

- **Initialization**: The initial scan can take a few seconds for large package sets
- **Memory**: The manager keeps an in-memory index of all resources
- **Caching**: File reads are not cached - consider implementing your own cache if needed

## Development

To install dependencies:

```bash
bun install
```

To run tests:

```bash
bun test
```

To run the example:

```bash
bun run example.ts
```

## Project Structure

```
fhir-canonical-manager/
├── src/
│   └── index.ts      # All implementation code
├── test/
│   └── index.test.ts # All tests
├── tools/
│   └── search-canonical.ts # CLI search tool
├── example.ts        # Usage example
├── package.json
├── tsconfig.json
└── README.md
```

## Requirements

- Bun v1.2.18+ or Node.js 18+
- TypeScript 5.0+

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

This project was created using `bun init` in bun v1.2.18. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.