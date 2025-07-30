# FHIR NPM Package Specification - Key Notes

## Overview

FHIR packages follow the NPM package format with FHIR-specific adaptations. They provide a standardized way to distribute FHIR conformance resources, implementation guides, and related artifacts.

## Package Structure

### Basic Structure
```
my-fhir-package.tgz
└── package/
    ├── package.json          # NPM manifest with FHIR extensions
    ├── .index.json          # Resource index for quick access
    ├── *.json               # FHIR resources (JSON format)
    └── examples/            # Optional: example resources
        ├── *.json
        └── .index.json
```

### Package Naming Convention

- Format: `<owner>.<id>` or `<owner>.<sub>.<id>`
- Each namespace: lowercase, starts with letter, followed by alphanumeric or dash
- Examples:
  - `hl7.fhir.r4.core`
  - `hl7.fhir.us.core`
  - `my-org.my-implementation-guide`

## Package.json Specification

### Required Fields

```json
{
  "name": "hl7.fhir.us.core",
  "version": "5.0.1",
  "description": "US Core Implementation Guide",
  "author": "HL7 US Realm Steering Committee",
  "dependencies": {
    "hl7.fhir.r4.core": "4.0.1",
    "hl7.terminology": "3.1.0"
  }
}
```

### Additional FHIR-Specific Fields

```json
{
  "type": "IG",                    // Package type
  "canonical": "http://hl7.org/fhir/us/core",
  "fhirVersions": ["4.0.1"],       // Supported FHIR versions
  "url": "http://hl7.org/fhir/us/core/ImplementationGuide/hl7.fhir.us.core",
  "title": "US Core Implementation Guide",
  "keywords": ["us-core", "fhir", "clinical"],
  "homepage": "http://hl7.org/fhir/us/core",
  "license": "CC0-1.0"
}
```

## Package Types

1. **Conformance**: Contains profiles, extensions, value sets, code systems
2. **IG (Implementation Guide)**: Complete implementation guide package
3. **Core**: Base FHIR specification resources
4. **Examples**: Example instances for testing
5. **Group**: Meta-package referencing other packages
6. **Tool**: Utilities and tools for FHIR
7. **IG-Template**: Templates for creating IGs

## Resource Organization

### File Naming
- StructureDefinitions: `StructureDefinition-<id>.json`
- ValueSets: `ValueSet-<id>.json`
- CodeSystems: `CodeSystem-<id>.json`
- Examples: Located in `examples/` subdirectory

### .index.json Format

The `.index.json` file is optional but recommended for efficient resource discovery. It contains:

```json
{
  "index-version": 2,
  "files": [
    {
      "filename": "StructureDefinition-us-core-patient.json",
      "resourceType": "StructureDefinition",
      "id": "us-core-patient",
      "url": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient",
      "version": "5.0.1",
      "kind": "resource",
      "type": "Patient",
      "derivation": "constraint",
      "baseDefinition": "http://hl7.org/fhir/StructureDefinition/Patient"
    }
  ]
}
```

#### Key Points:
- **Purpose**: Allows tools to quickly find resources without loading all files
- **Location**: In package root and optionally in examples/ folder
- **Generation**: Can be auto-generated from package resources
- **No Independent Data**: All information is derived from resources
- **Rebuilding**: Tools can rebuild if version not recognized

#### Common Fields:
- `filename`: Resource file name
- `resourceType`: FHIR resource type
- `id`: Resource identifier
- `url`: Canonical URL (if present in resource)
- `version`: Resource version (if present)
- `kind`: Resource kind (primitive, complex-type, resource, logical)
- `type`: For profiles, the constrained resource type
- Additional fields from the resource (e.g., `derivation`, `baseDefinition`)

## Versioning Rules

### Semantic Versioning
- Format: `MAJOR.MINOR.PATCH`
- MAJOR: Breaking changes
- MINOR: New functionality, backward compatible
- PATCH: Bug fixes

### Version Constraints
- Exact: `"4.0.1"`
- Patch wildcard: `"4.0.x"`
- No complex ranges (unlike npm)
- HL7 packages MUST use semantic versioning

## Dependencies

### Core Dependencies
Most packages depend on:
- `hl7.fhir.r[X].core`: Base FHIR specification
- `hl7.terminology`: FHIR terminology resources

### Dependency Resolution
- Dependencies must be complete (transitive dependencies included)
- Version conflicts resolved by most specific version
- Local development can use file paths: `"file:../local-package"`

## Package Registry

### Primary Registry
- URL: `http://packages.fhir.org`
- API endpoints:
  - `/catalog`: List all packages
  - `/<package>`: Package metadata
  - `/<package>/<version>`: Download specific version

### Publishing Process
1. Create package following specification
2. Register in RSS feed
3. Add RSS feed to master list at https://github.com/FHIR/ig-registry

### Registry API

```bash
# List all packages
GET http://packages.fhir.org/catalog

# Get package info
GET http://packages.fhir.org/hl7.fhir.us.core

# Download package
GET http://packages.fhir.org/hl7.fhir.us.core/5.0.1
```

## Best Practices

### Package Creation
1. Use consistent resource IDs
2. Include comprehensive metadata
3. Validate all resources before packaging
4. Test package installation
5. Document dependencies clearly

### Resource Guidelines
1. All resources must be valid JSON
2. Resources should have stable URLs
3. Use canonical URLs for references
4. Include version in resource metadata

### Dependency Management
1. Pin exact versions for stability
2. Test with all declared FHIR versions
3. Minimize dependency tree depth
4. Document breaking changes

## Differences from Standard NPM

### Removed Features
- No scripts or executable code
- No native modules
- Limited version range syntax
- No package-lock.json

### FHIR-Specific Additions
- `.index.json` for resource discovery
- Canonical URL support
- FHIR version compatibility
- Resource-specific organization

## Implementation Considerations

### For Package Managers
1. Cache packages locally
2. Build resource indexes for fast lookup
3. Support offline mode
4. Handle version conflicts gracefully
5. Validate package integrity

### For Package Authors
1. Follow naming conventions strictly
2. Include all transitive dependencies
3. Test across FHIR versions
4. Provide clear documentation
5. Use semantic versioning correctly

## Future Directions

1. **Signed Packages**: Cryptographic signatures for security
2. **Differential Downloads**: Only fetch changed resources
3. **Package Validation**: Automated quality checks
4. **Workspace Support**: Multi-package development
5. **CDN Distribution**: Faster global access

## References

- [HL7 FHIR Package Specification](https://confluence.hl7.org/display/FHIR/NPM+Package+Specification)
- [FHIR Packages Documentation](https://hl7.org/fhir/packages.html)
- [Package Registry](http://packages.fhir.org)
- [IG Registry](https://github.com/FHIR/ig-registry)