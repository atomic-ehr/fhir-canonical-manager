# FHIR Canonical Manager Specification

## Overview

The FHIR Canonical Manager is a comprehensive package management system designed specifically for FHIR (Fast Healthcare Interoperability Resources) packages. It provides tools for installing, creating, publishing, and managing FHIR packages while offering advanced features like canonical URL resolution and dependency management.

## Purpose

1. **Package Management**: Install, create, and publish FHIR packages
2. **Canonical Resolution**: Resolve FHIR resources by their canonical URLs
3. **Project Management**: Initialize and manage FHIR projects
4. **Dependency Tracking**: Handle inter-package dependencies
5. **Validation**: Ensure FHIR conformance and package integrity

## Core Features

### 1. Package Operations

#### Install
```bash
fcm install <package-name>[@version]
fcm install hl7.fhir.r4.core@4.0.1
fcm install ./local-package.tgz
fcm i <package-name>  # Short alias
```

#### Create
```bash
fcm init  # Initialize in current directory
fcm create <package-name>  # Create new package
```

#### Publish
```bash
fcm publish
fcm publish --registry https://packages.fhir.org
```

### 2. Canonical Resolution

The `$resolve` function allows resolution of FHIR resources by their canonical URLs:

```typescript
// Programmatic API
const resource = await fhirManager.$resolve('http://hl7.org/fhir/StructureDefinition/Patient');

// CLI
fcm resolve http://hl7.org/fhir/StructureDefinition/Patient
```

### 3. Project Structure

A typical FHIR project structure:

```
my-fhir-project/
├── package.json          # NPM package file with FHIR extensions
├── package-lock.json     # Lock file for dependencies
├── node_modules/         # Installed packages (npm compatible)
│   └── fhir_packages/    # FHIR-specific packages
├── fsh/                  # FHIR Shorthand files (optional)
├── input/                # Source resources
│   ├── profiles/         # StructureDefinitions
│   ├── valuesets/        # ValueSets
│   ├── codesystems/      # CodeSystems
│   └── examples/         # Example instances
├── output/               # Built package contents
├── .fhir/                # FHIR-specific cache and metadata
│   ├── cache/           # Resource cache
│   └── packages/        # Package cache
└── README.md            # Project documentation
```

### 4. Configuration Format

`package.json` (npm-compatible with FHIR extensions):
```json
{
  "name": "@my-organization/my-fhir-project",
  "version": "1.0.0",
  "description": "My FHIR Implementation Guide",
  "keywords": ["fhir", "healthcare", "hl7"],
  "homepage": "http://example.org/fhir/my-project",
  "license": "CC0-1.0",
  "author": {
    "name": "Organization Name",
    "email": "contact@example.org"
  },
  "maintainers": [{
    "name": "Maintainer Name",
    "email": "maintainer@example.org"
  }],
  "repository": {
    "type": "git",
    "url": "https://github.com/org/my-fhir-project.git"
  },
  "dependencies": {
    "hl7.fhir.r4.core": "4.0.1",
    "hl7.fhir.us.core": "5.0.1"
  },
  "scripts": {
    "test": "fcm validate",
    "build": "fcm build",
    "prepublishOnly": "fcm test && fcm build"
  },
  "fhir": {
    "canonical": "http://example.org/fhir/my-project",
    "fhirVersion": ["4.0.1", "4.3.0"],
    "resources": "./resources",
    "dependencies": {
      "hl7.terminology": "3.1.0"
    }
  }
}
```

## Architecture

### Components

1. **CLI Interface** (`/src/cli/`)
   - Command parser
   - Interactive prompts
   - Output formatting

2. **Core Library** (`/src/core/`)
   - Package manager
   - Canonical resolver
   - Dependency resolver
   - Validator

3. **Registry Client** (`/src/registry/`)
   - Package search
   - Download/upload
   - Authentication

4. **Cache Manager** (`/src/cache/`)
   - Local SQLite database
   - Resource indexing
   - Version management

5. **Project Manager** (`/src/project/`)
   - Project initialization
   - Configuration management
   - Build tools

## API Specification

### Programmatic API

```typescript
import { FHIRCanonicalManager } from '@atomic-ehr/fhir-canonical-manager';

// Initialize manager
const manager = new FHIRCanonicalManager({
  projectDir: './my-project',
  registryUrl: 'https://packages.fhir.org',
  cacheDir: '~/.fhir-cache'
});

// Install package
await manager.install('hl7.fhir.r4.core', '4.0.1');

// Resolve canonical
const patient = await manager.$resolve('http://hl7.org/fhir/StructureDefinition/Patient');

// Create new package
await manager.create({
  name: 'my-org.my-package',
  version: '1.0.0',
  canonical: 'http://example.org/fhir/my-package'
});

// Publish package
await manager.publish();

// Validate resources
const results = await manager.validate('./resources/profiles/MyProfile.json');

// Search local packages
const packages = await manager.search('core');

// Get package info
const info = await manager.info('hl7.fhir.r4.core');
```

### CLI Commands

```bash
# Package Management
fcm install <package>[@version]        # Install a package
fcm i <package>                        # Short alias for install
fcm uninstall <package>                # Remove a package
fcm un <package>                       # Short alias
fcm update [package]                   # Update packages
fcm up [package]                       # Short alias
fcm list                               # List installed packages
fcm ls                                 # Short alias
fcm search <query>                     # Search registry
fcm s <query>                          # Short alias
fcm info <package>                     # Show package details
fcm view <package>                     # Alias for info

# Project Management
fcm init                               # Initialize new project
fcm test                               # Run tests
fcm run <script>                       # Run scripts from fhir.json
fcm validate [path]                    # Validate resources
fcm build                              # Build package
fcm publish                            # Publish to registry
fcm pack                               # Create tarball

# Canonical Resolution
fcm resolve <canonical-url>            # Resolve by canonical URL
fcm find <resource-type> [--id <id>]   # Find resources

# Cache Management
fcm cache clean                        # Clear cache
fcm cache ls                           # List cached packages
fcm cache verify                       # Verify cache integrity

# Configuration
fcm config set <key> <value>           # Set config value
fcm config get <key>                   # Get config value
fcm config list                        # List all config
fcm config delete <key>                # Delete config value

# Version Management
fcm version                            # Show fcm version
fcm -v                                 # Short alias
```

## Package Format

FHIR packages follow the standard NPM package format with FHIR resources:

```
my-fhir-package-1.0.0.tgz
├── package/
│   ├── package.json           # NPM metadata with fhir field
│   ├── README.md              # Package documentation
│   ├── LICENSE                # License file
│   ├── .fhir.json            # Generated FHIR index
│   └── fhir/                 # FHIR resources directory
│       ├── StructureDefinition/
│       │   ├── Patient-us-core.json
│       │   └── Observation-lab.json
│       ├── ValueSet/
│       │   └── vs-observation-codes.json
│       ├── CodeSystem/
│       │   └── cs-custom-codes.json
│       └── examples/
│           └── Patient-example.json
```

### Resource Index Format

`.fhir.json` (auto-generated):
```json
{
  "packageId": "@my-org/my-fhir-package",
  "version": "1.0.0",
  "canonical": "http://example.org/fhir/my-package",
  "resources": {
    "StructureDefinition/Patient-us-core": {
      "url": "http://example.org/fhir/StructureDefinition/Patient-us-core",
      "version": "1.0.0",
      "type": "StructureDefinition",
      "kind": "resource",
      "derivation": "constraint",
      "baseDefinition": "http://hl7.org/fhir/StructureDefinition/Patient",
      "path": "fhir/StructureDefinition/Patient-us-core.json"
    }
  },
  "dependencies": {
    "hl7.fhir.r4.core": "4.0.1"
  }
}
```

## Dependency Resolution

The manager uses a dependency resolution algorithm similar to npm:

1. Read `fhir.json` dependencies
2. Resolve version constraints
3. Check for conflicts
4. Download missing packages
5. Build dependency tree
6. Install in order

### Version Constraints

- Exact: `"1.0.0"`
- Range: `">=1.0.0 <2.0.0"`
- Latest: `"latest"`
- Local: `"file:../local-package"`
- Git: `"git+https://github.com/org/repo.git"`

## Registry Protocol

### Package Publishing

```http
POST /packages
Content-Type: application/json
Authorization: Bearer <token>

{
  "name": "my-org.my-package",
  "version": "1.0.0",
  "package": "<base64-encoded-tgz>"
}
```

### Package Download

```http
GET /packages/{name}/{version}
Accept: application/gzip
```

### Search

```http
GET /search?q=patient&fhirVersion=4.0.1
Accept: application/json
```

## Implementation Details

### Technology Stack

- **Runtime**: Bun (for performance and native TypeScript support)
- **Database**: SQLite (via `bun:sqlite`) for local cache
- **HTTP Client**: Native fetch API
- **CLI**: Built-in Bun APIs
- **Testing**: `bun test`

### Performance Considerations

1. **Parallel Downloads**: Download dependencies concurrently
2. **Incremental Indexing**: Only index changed resources
3. **Memory-Mapped Cache**: Use SQLite for efficient lookups
4. **Lazy Loading**: Load resources on-demand
5. **Compressed Storage**: Store resources compressed

### Security

1. **Package Signing**: Verify package authenticity
2. **HTTPS Only**: Enforce secure connections
3. **Token Management**: Secure storage of auth tokens
4. **Checksum Validation**: Verify package integrity

## Usage Examples

### Creating a New FHIR Project

```bash
# Create new directory and initialize
mkdir my-fhir-ig && cd my-fhir-ig
fcm init

# Answer prompts or use flags
fcm init --name @myorg/my-ig --version 0.1.0 --fhir-version 4.0.1

# Install dependencies
fcm install hl7.fhir.r4.core
fcm install hl7.fhir.us.core@5.0.1

# Add dev dependencies
fcm install --save-dev hl7.fhir.validator
```

### Working with Resources

```bash
# Validate all resources
fcm validate

# Validate specific file
fcm validate input/profiles/MyPatient.json

# Find resources
fcm find StructureDefinition
fcm find ValueSet --id medication-codes

# Resolve canonical URL
fcm resolve http://hl7.org/fhir/StructureDefinition/Patient
```

### Publishing Packages

```bash
# Build package
fcm build

# Pack for local testing
fcm pack
# Creates: myorg-my-ig-0.1.0.tgz

# Publish to registry
fcm publish

# Publish with tag
fcm publish --tag beta
```

### Using in Code

```javascript
// ESM import
import { FHIRCanonicalManager } from '@atomic-ehr/fhir-canonical-manager';

// Initialize
const fcm = new FHIRCanonicalManager();

// Resolve a canonical
const patient = await fcm.$resolve('http://hl7.org/fhir/StructureDefinition/Patient');
console.log(patient.type); // "Patient"

// Search local packages
const profiles = await fcm.find('StructureDefinition', {
  baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient'
});
```

## NPM Compatibility Features

1. **NPM Registry Integration**: Publish FHIR packages to npm registry
2. **Package Scripts**: Run custom scripts via `fcm run <script>`
3. **Lifecycle Hooks**: Support npm lifecycle scripts (preinstall, postinstall, etc.)
4. **Workspaces**: Monorepo support for multiple FHIR packages
5. **Semantic Versioning**: Full semver support with ranges
6. **Peer Dependencies**: Handle FHIR version compatibility
7. **Lock Files**: Generate package-lock.json for reproducible installs
8. **Audit**: Security vulnerability checking for dependencies

## Future Enhancements

1. **Workspace Support**: Manage multiple related packages
2. **Plugin System**: Extend functionality via plugins
3. **GUI Interface**: Web-based package browser
4. **CI/CD Integration**: GitHub Actions, etc.
5. **Conflict Resolution**: Interactive merge tools
6. **Resource Editing**: Built-in FHIR resource editor
7. **Profiling Tools**: Performance analysis
8. **Migration Tools**: Convert from other formats
9. **FHIR Shorthand**: Native FSH support
10. **IG Publisher Integration**: Seamless IG building

## Conclusion

The FHIR Canonical Manager provides a comprehensive solution for managing FHIR packages, combining the familiarity of npm-style package management with FHIR-specific features like canonical URL resolution. Built on modern technologies like Bun, it offers performance, simplicity, and extensibility for the FHIR community.