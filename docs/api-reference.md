# API Reference

## CanonicalManager

The main interface for managing FHIR resources.

### Constructor

```typescript
CanonicalManager(config: Config): CanonicalManager
```

**Location:** [src/index.ts:674-986](../src/index.ts#L674-L986)

Creates a new CanonicalManager instance.

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `config` | `Config` | Configuration object |

#### Config Interface

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
  packages: ['hl7.fhir.r4.core@4.0.1', 'hl7.fhir.us.core@6.1.0'],
  workingDir: './fhir-cache',
  registry: 'https://custom-registry.com/'
});
```

### Methods

#### init()

```typescript
async init(): Promise<void>
```

**Location:** [src/index.ts:686-753](../src/index.ts#L686-L753)

Initializes the manager by installing packages and building the index.

**Behavior:**
1. Ensures working directory exists
2. Detects package manager (Bun/npm)
3. Installs missing packages
4. Scans and indexes all FHIR packages
5. Saves cache to disk

**Example:**
```typescript
await manager.init();
```

#### destroy()

```typescript
async destroy(): Promise<void>
```

**Location:** [src/index.ts:755-757](../src/index.ts#L755-L757)

Cleans up resources and saves cache.

**Example:**
```typescript
await manager.destroy();
```

#### packages()

```typescript
async packages(): Promise<PackageId[]>
```

**Location:** [src/index.ts:759-762](../src/index.ts#L759-L762)

Returns list of available packages.

**Returns:** Array of `PackageId` objects

```typescript
interface PackageId {
  name: string;
  version: string;
}
```

**Example:**
```typescript
const packages = await manager.packages();
// [{ name: 'hl7.fhir.r4.core', version: '4.0.1' }]
```

#### resolveEntry()

```typescript
async resolveEntry(
  canonicalUrl: string,
  options?: {
    package?: string;
    version?: string;
    sourceContext?: SourceContext;
  }
): Promise<IndexEntry>
```

**Location:** [src/index.ts:764-794](../src/index.ts#L764-L794)

Resolves a canonical URL to an index entry.

**Parameters:**
- `canonicalUrl` - The canonical URL of the resource
- `options` - Optional resolution options

**Returns:** `IndexEntry` object

```typescript
interface IndexEntry {
  id: string;
  url: string;
  type?: string;
  resourceType?: string;
  kind?: string;
  version?: string;
  package?: PackageId;
  indexVersion?: number;
}
```

**Example:**
```typescript
const entry = await manager.resolveEntry(
  'http://hl7.org/fhir/StructureDefinition/Patient'
);
```

#### resolve()

```typescript
async resolve(
  canonicalUrl: string,
  options?: {
    package?: string;
    version?: string;
    sourceContext?: SourceContext;
  }
): Promise<Resource>
```

**Location:** [src/index.ts:796-805](../src/index.ts#L796-L805)

Resolves a canonical URL directly to a resource.

**Parameters:**
- `canonicalUrl` - The canonical URL of the resource
- `options` - Optional resolution options

**Returns:** FHIR `Resource` object

**Example:**
```typescript
const patient = await manager.resolve(
  'http://hl7.org/fhir/StructureDefinition/Patient'
);
console.log(patient.resourceType); // "StructureDefinition"
```

#### read()

```typescript
async read(reference: Reference): Promise<Resource>
```

**Location:** [src/index.ts:807-831](../src/index.ts#L807-L831)

Reads a resource by its reference.

**Parameters:**
- `reference` - Reference object with id and optional package

```typescript
interface Reference {
  id: string;
  package?: PackageId;
}
```

**Example:**
```typescript
const resource = await manager.read({
  id: 'resource-id-123',
  package: { name: 'hl7.fhir.r4.core', version: '4.0.1' }
});
```

#### searchEntries()

```typescript
async searchEntries(params: {
  kind?: string;
  url?: string;
  type?: string;
  version?: string;
  package?: PackageId;
}): Promise<IndexEntry[]>
```

**Location:** [src/index.ts:833-873](../src/index.ts#L833-L873)

Searches for resources by various criteria.

**Parameters:**
- `kind` - Resource kind (e.g., 'resource', 'complex-type', 'primitive-type')
- `url` - Partial or full canonical URL
- `type` - Resource type (e.g., 'Patient', 'Observation')
- `version` - Resource version
- `package` - Specific package to search in

**Example:**
```typescript
// Find all StructureDefinitions
const entries = await manager.searchEntries({
  type: 'StructureDefinition'
});

// Find resources of kind 'resource'
const resources = await manager.searchEntries({
  kind: 'resource'
});
```

#### search()

```typescript
async search(params: {
  kind?: string;
  url?: string;
  type?: string;
  version?: string;
  package?: PackageId;
}): Promise<Resource[]>
```

**Location:** [src/index.ts:875-885](../src/index.ts#L875-L885)

Searches and returns full resources.

**Parameters:** Same as `searchEntries()`

**Returns:** Array of FHIR `Resource` objects

**Example:**
```typescript
const resources = await manager.search({
  type: 'StructureDefinition',
  kind: 'resource'
});
```

#### smartSearch()

```typescript
async smartSearch(
  searchTerms: string[],
  filters?: {
    resourceType?: string;
    type?: string;
    kind?: string;
    package?: PackageId;
  }
): Promise<IndexEntry[]>
```

**Location:** [src/index.ts:887-973](../src/index.ts#L887-L973)

Performs intelligent search with abbreviation support.

**Parameters:**
- `searchTerms` - Array of search terms (supports abbreviations)
- `filters` - Optional filters to narrow results

**Features:**
- Prefix matching on URL parts
- Abbreviation expansion ('str' → 'structure', 'def' → 'definition')
- Multi-field search (URL, type, resourceType)
- Supports all standard filters

**Abbreviation Support:**
| Abbreviation | Expands To |
|--------------|------------|
| `str` | structure |
| `def` | definition |
| `pati` | patient |
| `obs` | observation |
| `org` | organization |
| `pract` | practitioner |
| `med` | medication, medicinal |
| `req` | request |
| `resp` | response |
| `ref` | reference |
| `val` | value |
| `code` | codesystem, code |
| `cs` | codesystem |
| `vs` | valueset |
| `sd` | structuredefinition |

**Example:**
```typescript
// Search for StructureDefinition/Patient using abbreviations
const results = await manager.smartSearch(['str', 'def', 'pati']);

// Search with filters
const extensions = await manager.smartSearch(['patient'], {
  resourceType: 'StructureDefinition',
  kind: 'complex-type'
});
```

## Type Definitions

### Resource

```typescript
interface Resource {
  resourceType: string;
  id?: string;
  url?: string;
  version?: string;
  name?: string;
  title?: string;
  status?: string;
  kind?: string;
  [key: string]: any;
}
```

### PackageInfo

```typescript
interface PackageInfo {
  id: PackageId;
  path: string;
  canonical?: string;
  fhirVersions?: string[];
}
```

### SourceContext

```typescript
interface SourceContext {
  sourceUrl?: string;
  sourceVersion?: string;
}
```

## Error Handling

All methods that interact with the file system or network can throw errors:

- `Error: Not initialized` - Call `init()` before using other methods
- `Error: Canonical URL not found` - Resource doesn't exist
- `Error: Invalid reference` - Reference ID is invalid
- `Error: Package not found` - Specified package not available
- File system errors - Permission or disk space issues
- Network errors - Registry unreachable or package download failed

**Best Practices:**
```typescript
try {
  await manager.init();
  const resource = await manager.resolve(url);
} catch (error) {
  if (error.message.includes('not found')) {
    // Handle missing resource
  } else {
    // Handle other errors
  }
} finally {
  await manager.destroy();
}
```