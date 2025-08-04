# Types API

TypeScript interfaces and type definitions for FHIR Canonical Manager.

## Import

```typescript
import type {
  Resource,
  IndexEntry,
  Reference,
  PackageId,
  PackageInfo,
  CanonicalManager
} from '@atomic-ehr/fhir-canonical-manager';
```

## Core Types

### `Resource`

FHIR resource interface.

```typescript
interface Resource {
  resourceType: string;     // Required: StructureDefinition, ValueSet, etc.
  id?: string;             // Resource ID
  url?: string;            // Canonical URL
  version?: string;        // Resource version
  name?: string;           // Computer-friendly name
  title?: string;          // Human-friendly title
  status?: string;         // draft, active, retired
  kind?: string;           // resource, complex-type, primitive-type
  type?: string;           // For StructureDefinitions: Patient, Observation, etc.
  [key: string]: any;      // Other FHIR properties
}
```

### `IndexEntry`

Cached resource metadata.

```typescript
interface IndexEntry {
  id: string;              // Unique SHA256 reference ID
  url: string;             // Canonical URL
  type?: string;           // Resource type (for StructureDefinitions)
  resourceType?: string;   // FHIR resource type
  kind?: string;           // resource, complex-type, primitive-type
  version?: string;        // Resource version
  package?: PackageId;     // Source package
  indexVersion?: number;   // Index format version
}
```

### `Reference`

Resource reference for reading.

```typescript
interface Reference {
  id: string;              // Reference ID (SHA256 hash)
  resourceType?: string;   // Optional resource type hint
  package?: PackageId;     // Optional package constraint
}
```

### `PackageId`

Package identifier.

```typescript
interface PackageId {
  name: string;            // Package name (e.g., 'hl7.fhir.r4.core')
  version: string;         // Package version (e.g., '4.0.1')
}
```

### `PackageInfo`

Extended package information.

```typescript
interface PackageInfo {
  id: PackageId;           // Package identifier
  path: string;            // File system path
  canonical?: string;      // Canonical base URL
  fhirVersions?: string[]; // Supported FHIR versions
}
```

## Configuration Types

### `Config`

CanonicalManager configuration.

```typescript
interface Config {
  packages: string[];      // Package specs to install
  workingDir?: string;     // Working directory (default: cwd)
  registry?: string;       // NPM registry URL
}
```

### `SourceContext`

Resolution context for package-specific lookups.

```typescript
interface SourceContext {
  sourceUrl?: string;      // Source resource URL
  sourceVersion?: string;  // Source resource version
}
```

## Search Types

### `SearchParams`

Basic search parameters.

```typescript
interface SearchParams {
  kind?: string;           // Filter by kind
  url?: string;            // Partial URL match
  type?: string;           // Filter by type
  version?: string;        // Version constraint
  package?: PackageId;     // Package constraint
}
```

### `SmartSearchFilters`

Smart search filters.

```typescript
interface SmartSearchFilters {
  resourceType?: string;   // FHIR resource type
  type?: string;           // Resource type (for StructureDefinitions)
  kind?: string;           // Resource kind
  package?: PackageId;     // Package constraint
}
```

## Manager Interface

### `CanonicalManager`

Main manager interface.

```typescript
interface CanonicalManager {
  init(): Promise<void>;
  destroy(): Promise<void>;
  packages(): Promise<PackageId[]>;
  
  resolveEntry(
    canonicalUrl: string,
    options?: ResolveOptions
  ): Promise<IndexEntry>;
  
  resolve(
    canonicalUrl: string,
    options?: ResolveOptions
  ): Promise<Resource>;
  
  read(reference: Reference): Promise<Resource>;
  
  searchEntries(params: SearchParams): Promise<IndexEntry[]>;
  search(params: SearchParams): Promise<Resource[]>;
  
  smartSearch(
    searchTerms: string[],
    filters?: SmartSearchFilters
  ): Promise<IndexEntry[]>;
}
```

## Internal Types

### `CacheContent`

Cache storage format.

```typescript
interface CacheContent {
  version: number;         // Cache format version
  created: string;         // ISO timestamp
  packages: PackageInfo[]; // Installed packages
  index: IndexEntry[];     // Resource index
  packageLockHash?: string; // Lock file hash
}
```

### `ReferenceStore`

Reference storage format.

```typescript
interface ReferenceStore {
  [id: string]: {
    packageName: string;
    packageVersion: string;
    filePath: string;
  };
}
```

## Type Guards

```typescript
// Check if object is a valid Resource
function isResource(obj: any): obj is Resource {
  return obj && typeof obj.resourceType === 'string';
}

// Check if object is a valid IndexEntry
function isIndexEntry(obj: any): obj is IndexEntry {
  return obj && typeof obj.id === 'string' && typeof obj.url === 'string';
}

// Check if object is a valid PackageId
function isPackageId(obj: any): obj is PackageId {
  return obj && typeof obj.name === 'string' && typeof obj.version === 'string';
}
```

## Usage Examples

```typescript
// Type-safe resource handling
const handleResource = (resource: Resource) => {
  if (resource.resourceType === 'StructureDefinition') {
    console.log(`Structure: ${resource.type}`);
  }
};

// Working with index entries
const processEntry = (entry: IndexEntry) => {
  const { id, url, package: pkg } = entry;
  console.log(`${url} from ${pkg?.name}`);
};

// Package constraints
const constraint: PackageId = {
  name: 'hl7.fhir.r4.core',
  version: '4.0.1'
};
```