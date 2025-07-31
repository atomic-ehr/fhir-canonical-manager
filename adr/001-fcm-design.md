# ADR-001: FHIR Canonical Manager (FCM) Design

## Status
Accepted

## Context
FHIR resources are distributed through NPM packages, each containing multiple resources identified by canonical URLs. Developers need a way to:
- Initialize FHIR projects with required packages
- Install and manage FHIR packages from registries
- Discover what resources are available across packages
- Search and resolve resources by their canonical URLs
- Cache package metadata for performance

Currently, working with FHIR packages requires manual NPM installation and custom parsing logic for each project.

## Decision
We will create a FHIR Canonical Manager (FCM) that provides a high-level API for managing FHIR packages and resolving canonical URLs. The design includes:

### 1. Project Initialization
```typescript
const manager = CanonicalManager({
  packages: ["hl7.fhir.r4.core", "hl7.fhir.us.core@5.0.1"],
  workingDir: "./fhir-workspace",
  registry: "https://fs.get-ig.org/pkgs"
});

await manager.init();
```

- **Automatic Setup**: Creates working directory structure with `node_modules` and `.fcm/cache`
- **Package Installation**: Uses npm to install FHIR packages from specified registry
- **Version Support**: Supports specific versions using npm syntax (`package@version`)
- **Registry Configuration**: Allows custom registries for private/specialized packages

### 2. Package Management
```typescript
// List installed packages
const packages = await manager.packages();
// Returns: [{ name: "hl7.fhir.r4.core", version: "4.0.1", path: "..." }]

// Get package summary
packages.forEach(pkg => {
  console.log(`${pkg.name}@${pkg.version}`);
  console.log(`  Path: ${pkg.path}`);
  console.log(`  Resources: ${pkg.index?.length || 0}`);
});
```

- **Package Discovery**: Automatically finds installed FHIR packages in node_modules
- **Metadata Loading**: Reads package.json and .index.json files
- **Resource Counting**: Provides summary statistics for each package

### 3. Canonical URL Resolution
```typescript
// Direct resource resolution
const patient = await manager.resolve('http://hl7.org/fhir/StructureDefinition/Patient');

// Get index entry first
const entry = await manager.resolveEntry('http://hl7.org/fhir/StructureDefinition/Patient');
const resource = await manager.read(entry);
```

- **Direct Resolution**: Single method to get resource by URL
- **Two-Phase Resolution**: Separate index lookup from file reading for flexibility
- **Package Scoping**: Can resolve within specific package context
- **Error Handling**: Clear errors when resources not found

### 4. Resource Search
```typescript
// Search by various criteria
const results = await manager.search({
  type: 'StructureDefinition',
  kind: 'resource',
  url: 'Patient',  // partial match
  package: specificPackage
});

// Get index entries only
const entries = await manager.searchEntries({ type: 'ValueSet' });
```

- **Flexible Search**: Filter by type, kind, URL pattern, version, or package
- **Partial Matching**: URL search supports partial/substring matching
- **Performance**: Returns lightweight index entries by default
- **Batch Reading**: Can retrieve full resources when needed

### 5. Caching Strategy
```typescript
// Cache structure
.fcm/
  cache/
    packages.json         // List of discovered packages
    hl7.fhir.r4.core/
      index.json         // Processed index with reference IDs
      resources/         // Individual resource cache (future)
```

- **Disk Persistence**: Cache survives process restarts
- **JavaScript Objects**: Uses plain objects instead of Maps for serialization
- **Deterministic IDs**: SHA-256 based reference IDs for consistent lookups
- **Lazy Loading**: Resources loaded on-demand, not during initialization
- **Cache Invalidation**: Clears cache when packages change

### 6. Architecture Principles

#### Functional Design
- Factory functions instead of classes
- Immutable data structures
- No global state
- Composable operations

#### Performance First
- In-memory index for fast lookups
- Disk cache for persistence
- Lazy resource loading
- Batch operations support

#### Developer Experience
- Simple, intuitive API
- TypeScript-first with full types
- Clear error messages
- Minimal configuration

## Consequences

### Positive
- **Simplified Integration**: One library handles all FHIR package management
- **Performance**: Cached indexes enable fast canonical URL resolution
- **Flexibility**: Supports multiple packages and registries
- **Type Safety**: Full TypeScript support with exported types
- **Ecosystem Compatible**: Uses standard NPM packages and registries

### Negative
- **Disk Space**: Caching requires additional storage
- **Initial Setup Time**: First run needs to install packages and build cache
- **NPM Dependency**: Requires npm to be available for package installation
- **Cache Synchronization**: Cache may become stale if packages updated externally

### Future Enhancements
1. **Watch Mode**: Auto-reload when packages change
2. **Resource Validation**: Validate resources against their definitions
3. **Dependency Resolution**: Automatically install package dependencies
4. **CLI Tool**: Command-line interface for package management
5. **Resource Caching**: Cache individual resources, not just indexes
6. **Streaming API**: Handle large packages without loading everything

## Example Usage Scenarios

### Scenario 1: FHIR Validator
```typescript
const manager = CanonicalManager({
  packages: ["hl7.fhir.r4.core", "hl7.fhir.us.core"],
  workingDir: "./validator-workspace"
});

await manager.init();

// Load all StructureDefinitions for validation
const structures = await manager.search({ type: 'StructureDefinition' });
```

### Scenario 2: IG Development
```typescript
const manager = CanonicalManager({
  packages: ["hl7.fhir.r4.core", "my.custom.ig@dev"],
  workingDir: "./ig-workspace",
  registry: "https://my-registry.com"
});

// Find all resources in custom IG
const customResources = await manager.search({
  package: { name: "my.custom.ig" }
});
```

### Scenario 3: FHIR Server
```typescript
// Initialize once at startup
const manager = CanonicalManager({
  packages: requiredPackages,
  workingDir: "./fhir-server-data"
});

await manager.init();

// Fast canonical URL resolution during request handling
app.get('/metadata', async (req, res) => {
  const capabilityStatement = await manager.resolve(
    'http://hl7.org/fhir/CapabilityStatement/base'
  );
  res.json(capabilityStatement);
});
```

## References
- FHIR Package Specification: https://confluence.hl7.org/display/FHIR/NPM+Package+Specification
- NPM Registry API: https://docs.npmjs.com/cli/v8/using-npm/registry
- FHIR Canonical URLs: https://www.hl7.org/fhir/references.html#canonical