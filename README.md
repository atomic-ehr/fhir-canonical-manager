# @atomic-ehr/fhir-canonical-manager

[![npm version](https://badge.fury.io/js/@atomic-ehr%2Ffhir-canonical-manager.svg)](https://www.npmjs.com/package/@atomic-ehr/fhir-canonical-manager)

A TypeScript package manager for FHIR resources that provides canonical URL resolution. This library helps you discover, resolve, and manage FHIR packages and their resources through a simple, functional API.

## Features

- 🚀 **Automatic Package Management** - Automatically installs and manages FHIR packages
- 💾 **Persistent Caching** - Caches package metadata to disk for fast subsequent loads
- 🔍 **Canonical URL Resolution** - Resolve canonical URLs to specific resource versions
- 📦 **Multiple Package Support** - Work with multiple FHIR packages simultaneously
- 🎯 **Flexible Search** - Search resources by type, kind, URL, version, or package
- ⚡ **Performance Optimized** - In-memory cache with disk persistence
- 🛠️ **TypeScript First** - Full TypeScript support with comprehensive types
- 🖥️ **CLI Tool** - Command-line interface for package management and resource discovery

## Installation

```bash
bun install @atomic-ehr/fhir-canonical-manager
# or
npm install @atomic-ehr/fhir-canonical-manager
```

## Quick Start

```typescript
import { CanonicalManager } from '@atomic-ehr/fhir-canonical-manager';

// Create and initialize the manager
const manager = CanonicalManager({ 
    packages: ["hl7.fhir.r4.core"], 
    workingDir: "tmp/fhir",
    registry: "https://fs.get-ig.org/pkgs" // optional, default registry
});

await manager.init();

// Resolve and read a resource
const resource = await manager.resolve('http://hl7.org/fhir/StructureDefinition/Patient');
console.log(resource.url); // http://hl7.org/fhir/StructureDefinition/Patient
```

## CLI Usage

The package includes a command-line interface (`fcm`) for managing FHIR packages without writing code.

### Installation

```bash
# Install globally
npm install -g @atomic-ehr/fhir-canonical-manager

# Or use with npx
npx @atomic-ehr/fhir-canonical-manager
```

### Commands

#### `fcm init`
Initialize FHIR packages in the current directory.

```bash
# Initialize with packages
fcm init hl7.fhir.r4.core hl7.fhir.us.core@5.0.1

# With custom registry
fcm init hl7.fhir.r4.core --registry https://packages.simplifier.net

# Initialize from existing package.json
fcm init
```

Configuration is stored in `package.json`:
```json
{
  "fcm": {
    "packages": ["hl7.fhir.r4.core", "hl7.fhir.us.core@5.0.1"],
    "registry": "https://fs.get-ig.org/pkgs"
  }
}
```

#### `fcm list`
List installed packages or resources.

```bash
# List all packages
fcm list

# List resources in a package
fcm list hl7.fhir.r4.core

# Filter by type
fcm list hl7.fhir.r4.core --type StructureDefinition

# Output as JSON
fcm list --json
```

#### `fcm search`
Search for resources with advanced filtering and prefix matching capabilities.

**Basic Usage:**
```bash
# Search by URL pattern
fcm search Patient

# Prefix search - space-separated terms match URL components
fcm search str def pat  # Matches: StructureDefinition/Patient
```

**Resource Type Shortcuts:**
```bash
fcm search -sd          # All StructureDefinitions
fcm search -cs          # All CodeSystems
fcm search -vs          # All ValueSets
fcm search -sd patient  # Patient-related StructureDefinitions
```

**Advanced Filtering:**
```bash
# Filter by type (-t)
fcm search -t Extension              # All Extensions
fcm search -t Patient                # Resources with type="Patient"
fcm search -sd -t Patient            # Patient StructureDefinition specifically

# Filter by kind (-k)
fcm search -k resource               # All resources (Patient, Observation, etc.)
fcm search -k complex-type           # All complex types (HumanName, Address, etc.)
fcm search -k primitive-type         # All primitive types (string, boolean, etc.)

# Combine filters
fcm search -t Extension -k complex-type  # All Extension complex types
fcm search -sd pat -t Extension          # Patient-related Extensions

# Filter by package
fcm search allergy --package hl7.fhir.us.core

# Output as JSON
fcm search Patient --json
```

**Output Format:**
By default, results are displayed one per line in the format:
```
url, {"resourceType":"...", "kind":"...", "type":"..."}
```

Example output:
```
http://hl7.org/fhir/StructureDefinition/Patient, {"resourceType":"StructureDefinition","kind":"resource","type":"Patient"}
```

#### `fcm resolve`
Get a resource by its canonical URL.

```bash
# Display resource
fcm resolve http://hl7.org/fhir/StructureDefinition/Patient

# Save to file
fcm resolve http://hl7.org/fhir/ValueSet/administrative-gender > gender.json

# Show only specific fields
fcm resolve http://hl7.org/fhir/StructureDefinition/Patient --fields url,type,kind
```

### CLI Examples

```bash
# Set up a new FHIR project
mkdir my-fhir-project && cd my-fhir-project
fcm init hl7.fhir.r4.core

# Search for Observation-related resources
fcm search observation

# Get a specific resource and save it
fcm resolve http://hl7.org/fhir/StructureDefinition/Observation > observation.json

# List all ValueSets in JSON format
fcm search --type ValueSet --json > valuesets.json
```

## Core Concepts

### Package Management

The manager automatically handles FHIR package installation:

1. Creates a working directory if it doesn't exist
2. Initializes a `package.json` for dependency management
3. Installs specified FHIR packages using npm
4. Scans packages for `.index.json` files
5. Builds an in-memory index of all resources
6. Persists cache to `.fcm/cache/index.json`

### Resource Resolution

Resources are identified by:
- **Canonical URL**: The unique identifier for a FHIR resource
- **Reference ID**: An opaque, deterministic hash based on package and file path
- **Package Context**: Optional package name/version constraints

## API Reference

### `CanonicalManager(config)`

Creates a new instance of the canonical manager.

```typescript
interface Config {
  packages: string[];      // FHIR packages to install (e.g., ["hl7.fhir.r4.core"])
  workingDir: string;      // Directory for packages and cache
  registry?: string;       // NPM registry URL (optional)
}
```

Example:
```typescript
const manager = CanonicalManager({ 
    packages: [
        "hl7.fhir.r4.core",
        "hl7.fhir.us.core@5.0.1"
    ], 
    workingDir: "./fhir-packages",
    registry: "https://fs.get-ig.org/pkgs"
});
```

### `init(): Promise<void>`

Initializes the manager. This method:
- Ensures working directory exists
- Creates `.fcm/cache` directory
- Checks for existing cache
- If no cache: installs packages and builds index
- If cache exists: loads from disk (fast startup)

```typescript
await manager.init();
```

### `resolve(url, options?): Promise<Resource>`

Resolves a canonical URL directly to a FHIR resource.

```typescript
// Simple resolution
const patient = await manager.resolve(
    'http://hl7.org/fhir/StructureDefinition/Patient'
);

// With package constraint
const patient = await manager.resolve(
    'http://hl7.org/fhir/StructureDefinition/Patient',
    { package: 'hl7.fhir.r4.core' }
);

// With version constraint
const patient = await manager.resolve(
    'http://hl7.org/fhir/StructureDefinition/Patient',
    { version: '4.0.1' }
);
```

### `resolveEntry(url, options?): Promise<IndexEntry>`

Resolves a canonical URL to an index entry (metadata only).

```typescript
const entry = await manager.resolveEntry(
    'http://hl7.org/fhir/StructureDefinition/Patient'
);

console.log(entry);
// {
//   id: "opaque-reference-id",
//   resourceType: "StructureDefinition",
//   url: "http://hl7.org/fhir/StructureDefinition/Patient",
//   version: "4.0.1",
//   kind: "resource",
//   type: "Patient",
//   package: { name: "hl7.fhir.r4.core", version: "4.0.1" }
// }
```

### `read(reference): Promise<Resource>`

Reads a resource using its reference.

```typescript
const entry = await manager.resolveEntry(url);
const resource = await manager.read(entry);
```

### `search(params): Promise<Resource[]>`

Searches and returns full resources matching criteria.

```typescript
// Get all StructureDefinitions
const structures = await manager.search({ 
    type: 'StructureDefinition' 
});

// Get all resources of kind "resource"
const resources = await manager.search({ 
    kind: 'resource' 
});

// Complex search
const valuesets = await manager.search({ 
    type: 'ValueSet',
    package: { name: 'hl7.fhir.r4.core', version: '4.0.1' }
});
```

### `searchEntries(params): Promise<IndexEntry[]>`

Searches and returns index entries (metadata only).

```typescript
// Find all CodeSystems
const entries = await manager.searchEntries({ 
    type: 'CodeSystem' 
});

// Find by URL
const entries = await manager.searchEntries({ 
    url: 'http://hl7.org/fhir/StructureDefinition/Patient' 
});
```

Search parameters:
- `kind?: string` - Resource kind (e.g., 'resource', 'datatype', 'primitive')
- `url?: string` - Canonical URL (exact match)
- `type?: string` - Resource type (e.g., 'StructureDefinition', 'ValueSet')
- `version?: string` - Resource version
- `package?: PackageId` - Filter by package name and version

### `packages(): Promise<PackageId[]>`

Lists all loaded packages.

```typescript
const packages = await manager.packages();
// [
//   { name: "hl7.fhir.r4.core", version: "4.0.1" },
//   { name: "hl7.fhir.us.core", version: "5.0.1" }
// ]
```

### `destroy(): Promise<void>`

Cleans up resources and clears cache from memory (disk cache persists).

```typescript
await manager.destroy();
```

## CLI Reference

The `fcm` command-line interface provides comprehensive FHIR resource management capabilities.

### Command Overview

| Command | Description |
|---------|-------------|
| `fcm init [packages...]` | Initialize FHIR packages in current directory |
| `fcm list [package]` | List packages or resources |
| `fcm search [terms...]` | Search resources with advanced filtering |
| `fcm resolve <url>` | Get a resource by canonical URL |

### Global Options

- `--help`, `-h` - Show help information
- `--version`, `-v` - Show version number
- `--json` - Output results as JSON (available for list, search, resolve)

### Search Options

| Option | Description | Example |
|--------|-------------|---------|
| `-sd` | Filter to StructureDefinitions | `fcm search -sd` |
| `-cs` | Filter to CodeSystems | `fcm search -cs` |
| `-vs` | Filter to ValueSets | `fcm search -vs` |
| `-t <type>` | Filter by type field | `fcm search -t Extension` |
| `-k <kind>` | Filter by kind field | `fcm search -k resource` |
| `--type <resourceType>` | Filter by resourceType | `fcm search --type ValueSet` |
| `--package <name>` | Filter by package | `fcm search --package hl7.fhir.us.core` |

### Prefix Search

The search command supports intelligent prefix matching. When you provide multiple space-separated terms, each term is matched as a prefix against URL components:

```bash
# Search for "str" AND "def" AND "pat" as prefixes
fcm search str def pat

# This matches URLs like:
# - http://hl7.org/fhir/StructureDefinition/Patient
# - http://hl7.org/fhir/StructureDefinition/PatientContact
```

### Filter Combinations

Filters can be combined for precise searching:

```bash
# Find all Extension complex types
fcm search -t Extension -k complex-type

# Find Patient-related Extensions
fcm search -sd pat -t Extension

# Find all primitive types in US Core
fcm search -k primitive-type --package hl7.fhir.us.core
```

### Output Formats

**Default (Single-line):**
```
http://hl7.org/fhir/StructureDefinition/Patient, {"resourceType":"StructureDefinition","kind":"resource","type":"Patient"}
```

**JSON Format:**
```bash
fcm search Patient --json
```

Returns full IndexEntry objects as JSON array.

## Directory Structure

After initialization, your working directory will contain:

```
workingDir/
├── package.json          # NPM package file
├── node_modules/         # Installed FHIR packages
│   ├── hl7.fhir.r4.core/
│   │   ├── package.json
│   │   ├── .index.json   # FHIR resource index
│   │   └── *.json        # FHIR resources
│   └── .../
└── .fcm/
    └── cache/
        └── index.json    # Cached index for fast startup
```

## Cache Format

The cache is stored as a JSON file with the following structure:

```typescript
{
  entries: {
    "http://hl7.org/fhir/StructureDefinition/Patient": [
      {
        id: "hash-based-id",
        resourceType: "StructureDefinition",
        url: "http://hl7.org/fhir/StructureDefinition/Patient",
        version: "4.0.1",
        kind: "resource",
        type: "Patient",
        package: { name: "hl7.fhir.r4.core", version: "4.0.1" }
      }
    ]
  },
  packages: {
    "hl7.fhir.r4.core": {
      id: { name: "hl7.fhir.r4.core", version: "4.0.1" },
      path: "/path/to/node_modules/hl7.fhir.r4.core",
      canonical: "http://hl7.org/fhir",
      fhirVersions: ["4.0.1"]
    }
  },
  references: {
    "hash-based-id": {
      packageName: "hl7.fhir.r4.core",
      packageVersion: "4.0.1",
      filePath: "/path/to/resource.json",
      resourceType: "StructureDefinition",
      url: "http://hl7.org/fhir/StructureDefinition/Patient",
      version: "4.0.1"
    }
  }
}
```

## Advanced Usage

### Working with Multiple Packages

```typescript
const manager = CanonicalManager({ 
    packages: [
        "hl7.fhir.r4.core",
        "hl7.fhir.us.core@5.0.1",
        "hl7.fhir.us.davinci-drug-formulary"
    ], 
    workingDir: "./fhir-packages"
});

await manager.init();

// Search across all packages
const allValueSets = await manager.search({ type: 'ValueSet' });

// Search in specific package
const usCoreProfiles = await manager.search({ 
    type: 'StructureDefinition',
    package: { name: 'hl7.fhir.us.core', version: '5.0.1' }
});
```

### Custom Registry Configuration

```typescript
// Use the default FHIR package registry
const manager = CanonicalManager({ 
    packages: ["hl7.fhir.r4.core"],
    workingDir: "./fhir-packages",
    registry: "https://fs.get-ig.org/pkgs"
});

// Use a custom NPM registry
const manager = CanonicalManager({ 
    packages: ["hl7.fhir.r4.core"],
    workingDir: "./fhir-packages",
    registry: "https://my-private-registry.com"
});
```

### Building a FHIR Validator

```typescript
async function validateResource(resource: any, manager: CanonicalManager) {
    // Get the profile URL from the resource
    const profileUrl = resource.meta?.profile?.[0];
    if (!profileUrl) {
        throw new Error('No profile specified');
    }
    
    // Resolve the StructureDefinition
    const profile = await manager.resolve(profileUrl);
    
    // Validate resource against profile
    // ... validation logic ...
}
```

### Analyzing Package Dependencies

```typescript
async function analyzeValueSetDependencies(manager: CanonicalManager) {
    // Get all ValueSets
    const valueSets = await manager.search({ type: 'ValueSet' });
    
    const dependencies = new Map<string, Set<string>>();
    
    for (const vs of valueSets) {
        const vsPackage = vs.package?.name || 'unknown';
        
        // Check compose.include for external code systems
        if (vs.compose?.include) {
            for (const include of vs.compose.include) {
                if (include.system) {
                    try {
                        const cs = await manager.resolve(include.system);
                        const csPackage = cs.package?.name || 'unknown';
                        
                        if (csPackage !== vsPackage) {
                            if (!dependencies.has(vsPackage)) {
                                dependencies.set(vsPackage, new Set());
                            }
                            dependencies.get(vsPackage)!.add(csPackage);
                        }
                    } catch {
                        // External code system not in our packages
                    }
                }
            }
        }
    }
    
    return dependencies;
}
```

## Performance Considerations

### Startup Performance

- **First run**: Slower due to package installation and index building
- **Subsequent runs**: Fast startup by loading from disk cache
- **Cache invalidation**: Delete `.fcm/cache` to force rebuild

### Memory Usage

- All index entries are kept in memory for fast lookup
- Resource content is loaded on-demand
- For large package sets, consider memory requirements

### Best Practices

1. **Reuse manager instances**: Create once, use many times
2. **Use `searchEntries()` for metadata**: Faster than `search()` when you don't need full resources
3. **Specify package constraints**: Faster resolution when package is known
4. **Cache working directory**: Share between application instances

## Error Handling

The manager throws errors for:
- Not initialized: Call `init()` before other methods
- Resource not found: Canonical URL doesn't exist
- Invalid reference: Reference ID is invalid
- Package installation failures: Network or registry issues

```typescript
try {
    const resource = await manager.resolve('http://invalid.url/Resource');
} catch (error) {
    console.error('Failed to resolve:', error.message);
}
```

## TypeScript Types

```typescript
interface Reference {
    id: string;              // Opaque identifier
    resourceType: string;    // FHIR resource type
}

interface PackageId {
    name: string;           // Package name
    version: string;        // Package version
}

interface IndexEntry extends Reference {
    indexVersion: number;   // Index format version
    kind?: string;         // resource, datatype, primitive, etc.
    url?: string;          // Canonical URL
    type?: string;         // Specific type (e.g., "Patient")
    version?: string;      // Resource version
    package?: PackageId;   // Source package
}

interface Resource extends Reference {
    url?: string;          // Canonical URL
    version?: string;      // Resource version
    [key: string]: any;    // Other FHIR properties
}

interface SourceContext {
    id?: string;
    package?: PackageId;
    url?: string;
    path?: string;
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
bun tools/search-canonical.ts --package hl7.fhir.r4.core --type CodeSystem
```

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

### Project Structure

```
fhir-canonical-manager/
├── src/
│   └── index.ts          # All implementation code
├── test/
│   └── index.test.ts     # All tests
├── tools/
│   └── search-canonical.ts # CLI search tool
├── example.ts            # Usage example
├── package.json
├── tsconfig.json
└── README.md
```

## Requirements

- Node.js 18+ or Bun 1.0+
- TypeScript 5.0+
- Network access for package installation

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Guidelines

1. All code in single file: `src/index.ts`
2. Functional programming style
3. No external dependencies except Node.js built-ins
4. Comprehensive tests in `test/index.test.ts`
5. Update README.md with API changes