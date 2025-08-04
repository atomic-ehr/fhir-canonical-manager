# Reference Manager API

Manages unique resource identifiers and URL mappings using SHA256 hashing.

## Import

```typescript
import { 
  createReferenceManager,
  ReferenceManager 
} from '@atomic-ehr/fhir-canonical-manager';
```

## Factory Function

### `createReferenceManager(): ReferenceManagerFactory`

Creates a new reference manager instance.

```typescript
const refManager = createReferenceManager();
```

## Interface

### `ReferenceManager`

```typescript
interface ReferenceManager {
  generateId(metadata: ReferenceMetadata): string;
  addReference(id: string, metadata: ReferenceMetadata): void;
  getReference(id: string): ReferenceMetadata | undefined;
  getIdByUrl(url: string): string | undefined;
  mapUrlToId(url: string, id: string): void;
  getAllReferences(): ReferenceStore;
  hasReference(id: string): boolean;
  clear(): void;
}
```

## Core Functions

### `generateId(metadata): string`

Generates a unique SHA256-based ID for a resource.

```typescript
const id = refManager.generateId({
  packageName: 'hl7.fhir.r4.core',
  packageVersion: '4.0.1',
  filePath: 'StructureDefinition-Patient.json'
});
// Returns: "qXvp2N3K8x..."
```

#### Algorithm
```
input = "${packageName}@${packageVersion}:${filePath}"
id = sha256(input).toBase64Url()
```

### `addReference(id, metadata): void`

Stores a reference with its metadata.

```typescript
refManager.addReference(id, {
  packageName: 'hl7.fhir.r4.core',
  packageVersion: '4.0.1',
  filePath: 'StructureDefinition-Patient.json'
});
```

### `getReference(id): ReferenceMetadata | undefined`

Retrieves reference metadata by ID.

```typescript
const metadata = refManager.getReference('qXvp2N3K8x...');
if (metadata) {
  console.log(metadata.packageName);  // 'hl7.fhir.r4.core'
  console.log(metadata.filePath);     // 'StructureDefinition-Patient.json'
}
```

### `getIdByUrl(url): string | undefined`

Gets reference ID by canonical URL.

```typescript
const id = refManager.getIdByUrl(
  'http://hl7.org/fhir/StructureDefinition/Patient'
);
```

### `mapUrlToId(url, id): void`

Creates a mapping from URL to reference ID.

```typescript
refManager.mapUrlToId(
  'http://hl7.org/fhir/StructureDefinition/Patient',
  'qXvp2N3K8x...'
);
```

### `getAllReferences(): ReferenceStore`

Returns all stored references.

```typescript
const allRefs = refManager.getAllReferences();
// {
//   'qXvp2N3K8x...': { packageName: '...', ... },
//   'aB4cD5eF6...': { packageName: '...', ... }
// }
```

### `hasReference(id): boolean`

Checks if a reference ID exists.

```typescript
if (refManager.hasReference('qXvp2N3K8x...')) {
  // Reference exists
}
```

### `clear(): void`

Clears all references and mappings.

```typescript
refManager.clear();
```

## Types

### `ReferenceMetadata`

```typescript
interface ReferenceMetadata {
  packageName: string;      // Package name
  packageVersion: string;   // Package version
  filePath: string;        // Relative file path
}
```

### `ReferenceStore`

```typescript
interface ReferenceStore {
  [id: string]: ReferenceMetadata;
}
```

## Usage Examples

### Basic Reference Management

```typescript
const refManager = createReferenceManager();

// Generate and store reference
const metadata = {
  packageName: 'hl7.fhir.r4.core',
  packageVersion: '4.0.1',
  filePath: 'StructureDefinition-Patient.json'
};

const id = refManager.generateId(metadata);
refManager.addReference(id, metadata);
refManager.mapUrlToId('http://hl7.org/fhir/StructureDefinition/Patient', id);

// Later retrieval
const foundId = refManager.getIdByUrl('http://hl7.org/fhir/StructureDefinition/Patient');
const foundMetadata = refManager.getReference(foundId);
```

### Batch Processing

```typescript
const refManager = createReferenceManager();

// Process multiple resources
resources.forEach(resource => {
  const metadata = {
    packageName: resource.package.name,
    packageVersion: resource.package.version,
    filePath: resource.filePath
  };
  
  const id = refManager.generateId(metadata);
  refManager.addReference(id, metadata);
  
  if (resource.url) {
    refManager.mapUrlToId(resource.url, id);
  }
});
```

## Implementation Details

- **Location**: `src/reference/`
- **Hash Algorithm**: SHA256 with base64url encoding
- **Storage**: In-memory Maps for O(1) lookups
- **Thread Safety**: Not thread-safe

## ID Generation Stability

Reference IDs are deterministic and stable:
- Same input always produces same ID
- IDs persist across application restarts
- IDs are unique across packages and versions

## Performance

- `generateId`: O(1) + hashing time
- `addReference`: O(1)
- `getReference`: O(1)
- `getIdByUrl`: O(1)
- `mapUrlToId`: O(1)
- Memory: ~500 bytes per reference