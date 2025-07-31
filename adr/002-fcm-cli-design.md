# ADR-002: FCM CLI Tool Design

## Status
Proposed

## Context
While the FCM library provides a programmatic API for managing FHIR packages, developers need command-line tools for:
- Quick exploration of FHIR resources
- Project initialization and setup
- Package management without writing code
- Integration into build scripts and CI/CD pipelines
- Interactive exploration of canonical URLs

Current tools require custom scripts for each task, leading to inconsistent interfaces and duplicated effort.

## Decision
We will create a comprehensive CLI tool `fcm` that provides both interactive and non-interactive modes for FHIR package management.

### 1. CLI Architecture

#### Command Structure
```bash
fcm [command] [options]

Commands:
  init          Initialize a new FHIR project
  install       Install FHIR packages
  list          List installed packages or resources
  search        Search for resources by canonical URL
  resolve       Resolve a canonical URL to a resource
  explore       Interactive resource explorer
  config        Manage FCM configuration
```

#### Global Options
```bash
--working-dir, -w    Working directory (default: current directory)
--registry, -r       NPM registry URL (default: https://fs.get-ig.org/pkgs)
--format, -f         Output format: json, yaml, table (default: table)
--quiet, -q          Suppress non-essential output
--help, -h           Show help
--version, -v        Show version
```

### 2. Core Commands

#### `fcm init`
Initialize a new FHIR project with package management.

```bash
# Interactive mode
fcm init

# Non-interactive with options
fcm init --packages hl7.fhir.r4.core,hl7.fhir.us.core --dir my-fhir-project
```

Features:
- Creates project directory structure
- Generates `.fcm/config.json` configuration
- Optionally creates `package.json` for npm compatibility
- Installs specified packages

#### `fcm install`
Install FHIR packages into the current project.

```bash
# Install specific packages
fcm install hl7.fhir.r4.core hl7.fhir.us.core@5.0.1

# Install from config file
fcm install

# Install with specific registry
fcm install my.private.ig --registry https://my-registry.com
```

Features:
- Version support using npm syntax
- Multiple package installation
- Registry override per package
- Progress indicators for large packages

#### `fcm list`
List installed packages or resources.

```bash
# List all packages
fcm list packages

# List resources in a package
fcm list resources --package hl7.fhir.r4.core

# List specific resource types
fcm list resources --type StructureDefinition --kind resource

# Output as JSON
fcm list packages --format json
```

Output formats:
- **Table**: Human-readable with columns
- **JSON**: Machine-readable for scripting
- **YAML**: Human and machine readable
- **CSV**: For spreadsheet import

#### `fcm search`
Search for resources across packages.

```bash
# Search by partial URL
fcm search Patient

# Search with filters
fcm search --type ValueSet --url gender

# Search in specific package
fcm search --package hl7.fhir.us.core --type StructureDefinition

# Limit results
fcm search --type CodeSystem --limit 10
```

Features:
- Fuzzy/partial matching on URLs
- Multiple filter combinations
- Result highlighting
- Export capabilities

#### `fcm resolve`
Resolve a canonical URL and display the resource.

```bash
# Resolve and display
fcm resolve http://hl7.org/fhir/StructureDefinition/Patient

# Output specific format
fcm resolve http://hl7.org/fhir/ValueSet/administrative-gender --format yaml

# Save to file
fcm resolve http://hl7.org/fhir/CodeSystem/observation-status > observation-status.json

# Show specific fields only
fcm resolve http://hl7.org/fhir/StructureDefinition/Patient --fields url,name,kind,type
```

### 3. Interactive Mode

#### `fcm explore`
Launch interactive FHIR resource explorer.

```bash
fcm explore
```

Features:
- **Package Browser**: Navigate through installed packages
- **Resource Tree**: Hierarchical view of resources
- **Search Bar**: Real-time search with autocomplete
- **Resource Viewer**: Syntax-highlighted JSON/YAML display
- **Relationship Explorer**: Navigate references between resources
- **Export Options**: Save selected resources

UI Components:
```
┌─ Packages ──────────┬─ Resources ─────────────────────────┐
│ hl7.fhir.r4.core   │ Search: [Patient_____________]      │
│ > hl7.fhir.us.core │                                     │
│   my.custom.ig     │ StructureDefinition (134)           │
│                    │   □ Account                         │
│                    │   □ ActivityDefinition              │
│                    │   ■ Patient                         │
│                    │   □ Practitioner                    │
└────────────────────┴─────────────────────────────────────┘
┌─ Resource View ─────────────────────────────────────────┐
│ URL: http://hl7.org/fhir/StructureDefinition/Patient   │
│ Type: StructureDefinition                               │
│ Kind: resource                                          │
│                                                         │
│ {                                                       │
│   "resourceType": "StructureDefinition",               │
│   "url": "http://hl7.org/fhir/StructureDefinition/...", │
│   ...                                                   │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
[q]uit [e]xport [s]earch [/]filter [?]help
```

### 4. Configuration Management

#### Configuration File
`.fcm/config.json` in project root:

```json
{
  "version": "1.0",
  "packages": [
    "hl7.fhir.r4.core",
    "hl7.fhir.us.core@5.0.1"
  ],
  "registry": "https://fs.get-ig.org/pkgs",
  "registries": {
    "my.private.ig": "https://my-registry.com"
  },
  "cache": {
    "enabled": true,
    "ttl": 86400
  }
}
```

#### `fcm config`
Manage configuration settings.

```bash
# Show current config
fcm config show

# Set registry
fcm config set registry https://my-registry.com

# Add package
fcm config add package hl7.fhir.us.core@5.0.1

# Set package-specific registry
fcm config set registries.my.private.ig https://my-registry.com
```

### 5. Integration Features

#### Shell Completion
```bash
# Install completion
fcm completion bash > /etc/bash_completion.d/fcm
fcm completion zsh > ~/.zsh/completions/_fcm
```

#### Scripting Support
```bash
# Check if package installed
fcm list packages --format json | jq '.[] | select(.name=="hl7.fhir.r4.core")'

# Extract all ValueSets
fcm search --type ValueSet --format json | jq -r '.[] | .url' | \
  xargs -I {} fcm resolve {} > valuesets.ndjson

# Generate resource inventory
fcm list resources --format csv > resource-inventory.csv
```

#### CI/CD Integration
```yaml
# GitHub Actions example
- name: Setup FHIR packages
  run: |
    npm install -g @atomic-ehr/fcm
    fcm init --packages hl7.fhir.r4.core
    fcm list packages
```

### 6. Advanced Features

#### Resource Validation
```bash
# Validate a resource against its profile
fcm validate my-patient.json --profile http://hl7.org/fhir/StructureDefinition/Patient
```

#### Dependency Analysis
```bash
# Show package dependencies
fcm deps hl7.fhir.us.core

# Show resource dependencies
fcm deps http://hl7.org/fhir/StructureDefinition/Observation
```

#### Diff and Compare
```bash
# Compare resources between packages
fcm diff http://hl7.org/fhir/StructureDefinition/Patient \
  --package1 hl7.fhir.r4.core@4.0.1 \
  --package2 hl7.fhir.r4.core@4.0.2
```

### 7. Implementation Strategy

#### Technology Stack
- **CLI Framework**: Commander.js or Yargs for command parsing
- **Interactive UI**: Blessed or Ink for terminal UI
- **Configuration**: Cosmiconfig for flexible config loading
- **Output Formatting**: Chalk for colors, cli-table3 for tables
- **Progress**: ora or cli-progress for long operations

#### Package Distribution
```json
{
  "name": "@atomic-ehr/fcm",
  "bin": {
    "fcm": "./dist/cli.js"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

#### Error Handling
- Clear, actionable error messages
- Suggestions for common mistakes
- Debug mode with --verbose flag
- Proper exit codes for scripting

## Consequences

### Positive
- **Unified Interface**: Single tool for all FHIR package operations
- **Discoverability**: Easy exploration of available resources
- **Automation**: Scriptable commands for CI/CD
- **User-Friendly**: Interactive mode for exploration
- **Flexible Output**: Multiple formats for different use cases

### Negative
- **Complexity**: More code to maintain than library alone
- **Dependencies**: Additional CLI-specific dependencies
- **Platform Testing**: Must test on multiple OS/shell combinations
- **Documentation**: Requires extensive command documentation

### Migration Path
1. Start with core commands (init, install, list, search, resolve)
2. Add interactive explorer as separate feature
3. Implement advanced features based on user feedback
4. Maintain backward compatibility for scripting

## Examples

### Example 1: Project Setup
```bash
# Initialize new project
fcm init my-fhir-app
cd my-fhir-app

# Install packages
fcm install hl7.fhir.r4.core hl7.fhir.us.core@5.0.1

# Verify installation
fcm list packages
```

### Example 2: Resource Discovery
```bash
# Find all Observation-related resources
fcm search Observation

# Get specific resource
fcm resolve http://hl7.org/fhir/StructureDefinition/Observation --format yaml

# Explore interactively
fcm explore
```

### Example 3: Build Script Integration
```bash
#!/bin/bash
# ci-check-fhir.sh

set -e

# Ensure packages are installed
fcm install

# Verify expected packages
EXPECTED_PACKAGES="hl7.fhir.r4.core hl7.fhir.us.core"
INSTALLED=$(fcm list packages --format json | jq -r '.[].name' | tr '\n' ' ')

for pkg in $EXPECTED_PACKAGES; do
  if [[ ! $INSTALLED =~ $pkg ]]; then
    echo "Missing required package: $pkg"
    exit 1
  fi
done

echo "All FHIR packages verified"
```

## References
- Commander.js: https://github.com/tj/commander.js
- Blessed Terminal UI: https://github.com/chjj/blessed
- Cosmiconfig: https://github.com/davidtheclark/cosmiconfig
- NPM Package Best Practices: https://docs.npmjs.com/cli/v8/using-npm/developers