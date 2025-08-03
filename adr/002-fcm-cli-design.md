# ADR-002: FCM CLI Tool Design

## Status
Proposed (Revised for Minimalistic Approach)

## Context
While the FCM library provides a programmatic API for managing FHIR packages, developers need command-line tools for:
- Quick exploration of FHIR resources
- Basic package management without writing code
- Simple canonical URL resolution
- Integration into scripts and workflows

Current approaches require custom scripts for each task, but a full-featured CLI might be overly complex for most use cases.

## Decision
We will create a minimalistic CLI tool `fcm` that focuses on essential FHIR package management tasks with a simple, predictable interface.

### 1. Core Design Principles

- **Minimal Commands**: Only essential operations
- **Simple Output**: Default to human-readable, with JSON option
- **Standard Configuration**: Use package.json for project config
- **No Interactive Mode**: Unix philosophy - do one thing well
- **Predictable Behavior**: No magic, no hidden state

### 2. Command Structure

```bash
fcm <command> [options]

Commands:
  init       Initialize FHIR packages in current directory
  list       List packages or resources
  search     Search for resources
  resolve    Get a resource by canonical URL

Options:
  --help     Show help
  --version  Show version
```

### 3. Essential Commands

#### `fcm init`
Initialize FHIR packages in the current directory.

```bash
# Initialize with packages
fcm init hl7.fhir.r4.core hl7.fhir.us.core@5.0.1

# With custom registry
fcm init hl7.fhir.r4.core --registry https://fs.get-ig.org/pkgs/

# Initialize from existing package.json
fcm init
```

What it does:
- Creates/updates `package.json` with fcm configuration
- Runs `npm install` for specified packages
- Creates `.fcm/cache` directory
- Shows installed packages summary

Configuration in package.json:
```json
{
  "name": "my-fhir-project",
  "fcm": {
    "packages": [
      "hl7.fhir.r4.core",
      "hl7.fhir.us.core@5.0.1"
    ],
    "registry": "https://fs.get-ig.org/pkgs/"
  }
}

#### `fcm list`
List installed packages or resources.

```bash
# List all packages (default)
fcm list

# List resources in a package
fcm list hl7.fhir.r4.core

# Filter by type
fcm list hl7.fhir.r4.core --type StructureDefinition

# JSON output
fcm list --json
```

Output example:
```
Packages:
  hl7.fhir.r4.core@4.0.1 (1,342 resources)
  hl7.fhir.us.core@5.0.1 (234 resources)
```

#### `fcm search`
Search for resources by canonical URL pattern.

```bash
# Search across all packages
fcm search Patient

# Search with type filter
fcm search observation --type ValueSet

# Search in specific package
fcm search allergy --package hl7.fhir.us.core

# JSON output
fcm search Patient --json
```

Output example:
```
Found 3 resources matching "Patient":
  http://hl7.org/fhir/StructureDefinition/Patient
    Type: StructureDefinition, Package: hl7.fhir.r4.core
  http://hl7.org/fhir/ValueSet/patient-contactrelationship
    Type: ValueSet, Package: hl7.fhir.r4.core
  http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient
    Type: StructureDefinition, Package: hl7.fhir.us.core
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

### 4. Common Options

All commands support:
- `--json` - Output as JSON instead of formatted text
- `--quiet` - Suppress informational messages
- `--help` - Show command-specific help

### 5. Implementation Details

#### Configuration Management
- Configuration stored in `package.json` under `fcm` key
- Commands read config from current directory's package.json
- Command-line options override configuration
- No global configuration or user preferences

#### Simple Output Formats
- Default: Human-readable text
- JSON: For scripting (with --json flag)
- No tables, colors, or spinners by default

#### Error Handling
```bash
# Clear error messages
$ fcm resolve http://unknown.url/Resource
Error: Resource not found: http://unknown.url/Resource

# Proper exit codes
$ fcm search Patient && echo "Found" || echo "Not found"
```

#### Package Management
- Relies on npm for package installation
- No custom package management
- No version resolution beyond npm

### 6. Configuration in package.json

The CLI reads configuration from the `fcm` key in package.json:

```json
{
  "name": "my-fhir-project",
  "version": "1.0.0",
  "fcm": {
    "packages": [
      "hl7.fhir.r4.core",
      "hl7.fhir.us.core@5.0.1"
    ],
    "registry": "https://fs.get-ig.org/pkgs/"
  },
  "dependencies": {
    "hl7.fhir.r4.core": "^4.0.1",
    "hl7.fhir.us.core": "^5.0.1"
  }
}
```

Configuration behavior:
- `fcm init` creates/updates the `fcm` section
- `fcm init` also adds packages to `dependencies`
- All commands read from `fcm` section if present
- Command-line arguments override config values
- Missing `fcm` section is not an error

### 7. Usage Examples

#### Example 1: Quick Setup
```bash
# Initialize a project
mkdir my-fhir-project && cd my-fhir-project
fcm init hl7.fhir.r4.core hl7.fhir.us.core@5.0.1

# Check what's installed
fcm list

# Add more packages later
fcm init hl7.fhir.extensions
```

#### Example 2: Find and Use Resources
```bash
# Search for observation-related resources
fcm search observation --type StructureDefinition

# Get a specific resource
fcm resolve http://hl7.org/fhir/StructureDefinition/Observation > observation.json
```

#### Example 3: Scripting
```bash
#!/bin/bash
# Extract all ValueSets

# Get all ValueSet URLs as JSON
VALUESETS=$(fcm search "" --type ValueSet --json | jq -r '.[].url')

# Resolve each one
for url in $VALUESETS; do
  filename=$(echo $url | sed 's/[^a-zA-Z0-9]/_/g').json
  fcm resolve "$url" > "valuesets/$filename"
done
```

#### Example 4: CI Integration
```bash
# .github/workflows/test.yml
- name: Setup FHIR
  run: |
    npm install -g @atomic-ehr/fcm
    fcm init hl7.fhir.r4.core hl7.fhir.us.core@5.0.1
    fcm list
```

### 7. What's NOT Included

To keep the tool simple and focused:

- ❌ Interactive UI or explorer
- ❌ Separate configuration files (uses package.json)
- ❌ Package dependency resolution
- ❌ Resource validation
- ❌ Diff/comparison features
- ❌ Shell completion
- ❌ Progress bars or spinners
- ❌ Colored output by default
- ❌ Multiple output formats (only text and JSON)
- ❌ Watch mode or file monitoring
- ❌ Custom registries per package
- ❌ Caching configuration

## Consequences

### Positive
- **Simple to Learn**: Only 4 commands to remember
- **Predictable**: No configuration means consistent behavior
- **Scriptable**: JSON output and proper exit codes
- **Fast**: Minimal overhead, no complex features
- **Maintainable**: Less code, fewer dependencies

### Negative
- **Limited Features**: No advanced functionality
- **No Customization**: No user preferences or configuration
- **Basic Output**: No rich terminal UI features
- **Manual Work**: Some tasks require scripting

### Future Considerations

If users need more features, consider:
1. Creating separate specialized tools (fcm-explorer, fcm-validator)
2. Adding features only if they maintain simplicity
3. Keeping the core tool minimal

## Implementation Notes

### Technology Choices
- **Minimal Dependencies**: Only essential npm packages
- **No CLI Framework**: Simple argument parsing
- **Built with Bun**: Fast execution, single binary potential

### Package Structure
```typescript
// Simple command dispatch
const commands = {
  init: initCommand,
  list: listCommand,
  search: searchCommand,
  resolve: resolveCommand
};

const command = process.argv[2];
if (commands[command]) {
  await commands[command](process.argv.slice(3));
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
```

## References
- Unix Philosophy: https://en.wikipedia.org/wiki/Unix_philosophy
- 12 Factor CLI Apps: https://medium.com/@jdxcode/12-factor-cli-apps-dd3c227a0e46
