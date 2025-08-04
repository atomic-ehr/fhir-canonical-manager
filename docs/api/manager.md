# CanonicalManager API

The main orchestration layer that coordinates all other modules.

## Import

```typescript
import { CanonicalManager } from '@atomic-ehr/fhir-canonical-manager';
// or
import { createCanonicalManager } from '@atomic-ehr/fhir-canonical-manager';
```

## Factory Function

### `CanonicalManager(config: Config): ICanonicalManager`

Creates a new CanonicalManager instance.

#### Parameters

```typescript
interface Config {
  packages: string[];           // FHIR packages to install/use
  workingDir?: string;          // Directory for cache and packages (default: cwd)
  registry?: string;            // NPM registry URL (default: https://fs.get-ig.org/pkgs/)
}
```

#### Example

```typescript
const manager = CanonicalManager({
  packages: ['hl7.fhir.r4.core@4.0.1'],
  workingDir: './fhir-cache',
  registry: 'https://fs.get-ig.org/pkgs/'
});
```

## Methods

### `init(): Promise<void>`

Initializes the manager by installing packages and building the index.

```typescript
await manager.init();
```

**Process:**
1. Creates working directory if needed
2. Detects package manager (Bun/npm)
3. Installs missing packages
4. Scans all FHIR packages
5. Builds resource index
6. Saves cache to disk

### `destroy(): Promise<void>`

Cleans up resources and saves cache.

```typescript
await manager.destroy();
```

### `packages(): Promise<PackageId[]>`

Returns list of installed FHIR packages.

```typescript
const packages = await manager.packages();
// [{ name: 'hl7.fhir.r4.core', version: '4.0.1' }]
```

### `resolveEntry(url: string, options?): Promise<IndexEntry>`

Resolves a canonical URL to an index entry.

```typescript
const entry = await manager.resolveEntry(
  'http://hl7.org/fhir/StructureDefinition/Patient',
  { package: 'hl7.fhir.r4.core' }
);
```

#### Options

```typescript
interface ResolveOptions {
  package?: string;        // Package name constraint
  version?: string;        // Version constraint
  sourceContext?: {        // Resolution context
    sourceUrl?: string;
    sourceVersion?: string;
  };
}
```

### `resolve(url: string, options?): Promise<Resource>`

Resolves a canonical URL directly to a FHIR resource.

```typescript
const patient = await manager.resolve(
  'http://hl7.org/fhir/StructureDefinition/Patient'
);
```

### `read(reference: Reference): Promise<Resource>`

Reads a resource by its reference ID.

```typescript
const resource = await manager.read({
  id: 'sha256-hash-id',
  resourceType: 'StructureDefinition'
});
```

### `searchEntries(params): Promise<IndexEntry[]>`

Searches for resources by various criteria.

```typescript
const entries = await manager.searchEntries({
  type: 'StructureDefinition',
  kind: 'resource'
});
```

#### Search Parameters

```typescript
interface SearchParams {
  kind?: string;         // resource, complex-type, primitive-type
  url?: string;          // Partial URL match
  type?: string;         // Resource type (Patient, Observation)
  version?: string;      // Version constraint
  package?: PackageId;   // Package constraint
}
```

### `search(params): Promise<Resource[]>`

Searches and returns full resources.

```typescript
const resources = await manager.search({
  type: 'StructureDefinition',
  kind: 'resource'
});
```

### `smartSearch(terms: string[], filters?): Promise<IndexEntry[]>`

Performs intelligent search with abbreviation support.

```typescript
// Search with abbreviations
const results = await manager.smartSearch(['str', 'def', 'pati']);

// With filters
const valuesets = await manager.smartSearch(['val'], {
  resourceType: 'ValueSet'
});
```

#### Filters

```typescript
interface SmartSearchFilters {
  resourceType?: string;
  type?: string;
  kind?: string;
  package?: PackageId;
}
```

## Error Handling

```typescript
try {
  await manager.init();
  const resource = await manager.resolve(url);
} catch (error) {
  if (error.message.includes('not initialized')) {
    // Manager needs initialization
  } else if (error.message.includes('not found')) {
    // Resource doesn't exist
  }
}
```

## Lifecycle

```typescript
// Create
const manager = CanonicalManager(config);

// Initialize
await manager.init();

// Use
const resource = await manager.resolve(url);

// Cleanup
await manager.destroy();
```

## Implementation Details

- Location: `src/manager/canonical.ts`
- Dependencies: All other modules
- State: Maintains cache, reference manager, and package list
- Thread Safety: Not thread-safe; use one instance per process