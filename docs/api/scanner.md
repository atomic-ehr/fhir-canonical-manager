# Scanner API

Discovers and indexes FHIR packages in the file system.

## Import

```typescript
// Internal module - not directly exported
// Used internally by CanonicalManager
```

## Core Functions

### `scanPackages(workingDir): Promise<PackageInfo[]>`

Scans for FHIR packages in node_modules.

```typescript
const packages = await scanPackages('./fhir-cache');
```

#### Process

1. Reads all directories in `node_modules`
2. Checks for `.index.json` files
3. Handles scoped packages (`@org/package`)
4. Returns package metadata

### `scanDirectory(dir, packageInfo, refManager): Promise<IndexEntry[]>`

Indexes all resources in a package directory.

```typescript
const entries = await scanDirectory(
  packagePath,
  packageInfo,
  referenceManager
);
```

#### Parameters

```typescript
dir: string                  // Package directory path
packageInfo: PackageInfo     // Package metadata
refManager: ReferenceManager // Reference ID manager
```

### `processIndex(indexPath, packageInfo, refManager): Promise<IndexEntry[]>`

Processes a `.index.json` file.

```typescript
const entries = await processIndex(
  '.index.json',
  packageInfo,
  referenceManager
);
```

### `parseIndexFile(content): any`

Parses and validates index JSON content.

```typescript
const index = parseIndexFile(jsonString);
```

#### Validation

- Checks for `files` object
- Validates resource entries
- Handles malformed JSON

## Index File Format

### `.index.json` Structure

```json
{
  "files": [
    {
      "resourceType": "StructureDefinition",
      "id": "Patient",
      "url": "http://hl7.org/fhir/StructureDefinition/Patient",
      "type": "Patient",
      "kind": "resource",
      "version": "4.0.1",
      "filename": "StructureDefinition-Patient.json"
    }
  ]
}
```

### Entry Mapping

```typescript
// .index.json entry → IndexEntry
{
  id: generateId(metadata),           // SHA256 hash
  url: entry.url,                     // Canonical URL
  type: entry.type,                   // Resource type
  resourceType: entry.resourceType,   // FHIR type
  kind: entry.kind,                   // resource/complex-type
  version: entry.version,             // Resource version
  package: packageInfo.id,            // Source package
  indexVersion: 1                     // Index format version
}
```

## Package Discovery

### Directory Structure

```
node_modules/
├── hl7.fhir.r4.core/
│   ├── package/
│   │   ├── .index.json
│   │   └── *.json (resources)
│   └── package.json
├── @org/
│   └── scoped-package/
│       ├── package/
│       │   └── .index.json
│       └── package.json
```

### Package Detection

```typescript
function isFhirPackage(dir: string): boolean {
  // Has .index.json in package/ subdirectory
  return fs.existsSync(path.join(dir, 'package', '.index.json'));
}
```

## Error Handling

### Silent Failures

Scanner continues on errors:

```typescript
try {
  const entries = await processIndex(indexPath, pkg, refManager);
  allEntries.push(...entries);
} catch (error) {
  // Log and continue
  console.warn(`Failed to process ${indexPath}: ${error.message}`);
}
```

### Common Issues

1. **Missing .index.json**: Package skipped
2. **Malformed JSON**: Package skipped
3. **Invalid entries**: Individual entries skipped
4. **Permission errors**: Package skipped

## Performance

### Optimizations

- **Parallel Processing**: Packages scanned concurrently
- **Lazy Loading**: Resources loaded on-demand
- **Reference Caching**: IDs generated once

### Benchmarks

- **Scan Time**: ~500ms for 50 packages
- **Index Size**: ~2KB per package
- **Memory**: ~100KB per package

## Usage Example

```typescript
// Internal usage
async function buildIndex(workingDir: string) {
  const refManager = createReferenceManager();
  const packages = await scanPackages(workingDir);
  
  const allEntries: IndexEntry[] = [];
  
  for (const pkg of packages) {
    const entries = await scanDirectory(
      pkg.path,
      pkg,
      refManager
    );
    allEntries.push(...entries);
  }
  
  return { entries: allEntries, refManager };
}
```

## Scoped Packages

Handles npm scoped packages:

```typescript
// Discovers packages like:
// @hl7/fhir-r4-core
// @custom/fhir-profiles

const scopedPath = path.join(nodeModules, '@org', 'package');
if (await isFhirPackage(scopedPath)) {
  packages.push({
    id: { name: '@org/package', version: '1.0.0' },
    path: scopedPath
  });
}
```

## Resource Discovery Rules

### Included Resources

- Must have `url` field
- Must have `resourceType` field
- Must be in `.index.json` files array

### Excluded Resources

- Resources without canonical URLs
- Malformed entries
- Duplicate URLs (first wins)

## Implementation Details

- **Location**: `src/scanner/`
- **Dependencies**: File system, Reference Manager
- **Async**: All operations are async
- **Error Recovery**: Continues on failure