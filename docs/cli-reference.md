# CLI Reference

The FHIR Canonical Manager CLI (`fcm`) provides command-line access to all core functionality.

## Installation

```bash
npm install -g @atomic-ehr/fhir-canonical-manager
# or
bun add -g @atomic-ehr/fhir-canonical-manager
```

## Global Options

| Option | Description |
|--------|-------------|
| `--help`, `-h` | Show help information |
| `--version`, `-v` | Show version number |

## Commands

### fcm init

Initialize FHIR packages in the current directory.

**Location:** [src/cli/init.ts](../src/cli/init.ts)

#### Syntax
```bash
fcm init [packages...] [options]
```

#### Options
| Option | Description |
|--------|-------------|
| `--registry <url>` | Custom NPM registry URL |

#### Behavior
1. Creates/updates `package.json` with `fcm` configuration
2. Installs specified packages from registry
3. Builds package index
4. Creates `.fcm/cache/` directory

#### Examples
```bash
# Initialize with single package
fcm init hl7.fhir.r4.core

# Initialize with specific version
fcm init hl7.fhir.r4.core@4.0.1

# Initialize multiple packages
fcm init hl7.fhir.r4.core hl7.fhir.us.core@6.1.0

# Use custom registry
fcm init hl7.fhir.r4.core --registry https://custom-registry.com/
```

#### package.json Configuration
The command adds an `fcm` section to `package.json`:
```json
{
  "fcm": {
    "packages": [
      "hl7.fhir.r4.core@4.0.1",
      "hl7.fhir.us.core@6.1.0"
    ],
    "registry": "https://fs.get-ig.org/pkgs/"
  }
}
```

### fcm list

List installed packages or resources within a package.

**Location:** [src/cli/list.ts](../src/cli/list.ts)

#### Syntax
```bash
fcm list [package-name] [options]
```

#### Options
| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format |
| `--type <type>` | Filter by resource type |

#### Examples
```bash
# List all installed packages
fcm list

# List resources in a specific package
fcm list hl7.fhir.r4.core

# Filter by resource type
fcm list hl7.fhir.r4.core --type StructureDefinition

# Output as JSON
fcm list --json
```

#### Output Format
Default (human-readable):
```
Packages:
  hl7.fhir.r4.core@4.0.1
  hl7.fhir.us.core@6.1.0
```

With package name:
```
Resources in hl7.fhir.r4.core:
  StructureDefinition: 655
  ValueSet: 423
  CodeSystem: 152
  ...
  
Total: 4574 resources
```

### fcm search

Search for FHIR resources using smart search with abbreviation support.

**Location:** [src/cli/search.ts](../src/cli/search.ts)

#### Syntax
```bash
fcm search [search-terms...] [options]
```

#### Options
| Option | Alias | Description |
|--------|-------|-------------|
| `--json` | | Output in JSON format |
| `--type <type>` | | Filter by resourceType |
| `-t <type>` | | Filter by type field |
| `-k <kind>` | | Filter by kind |
| `--package <name>` | | Filter by package |
| `-sd` | | Shortcut for StructureDefinition |
| `-cs` | | Shortcut for CodeSystem |
| `-vs` | | Shortcut for ValueSet |

#### Smart Search Features
- **Prefix Matching:** Matches beginning of words in URLs
- **Abbreviation Support:** Automatically expands common abbreviations
- **Multi-term Search:** All terms must match (AND logic)

#### Supported Abbreviations
| Input | Matches |
|-------|---------|
| `str` | structure |
| `def` | definition |
| `pati` | patient |
| `obs` | observation |
| `org` | organization |
| `val` | value |
| `vs` | valueset |
| `cs` | codesystem |
| `sd` | structuredefinition |

#### Examples
```bash
# Search using abbreviations
fcm search str def pati
# Finds: StructureDefinition/Patient

# Search for Observation resources
fcm search obs

# Filter by StructureDefinition
fcm search patient -sd

# Filter by kind
fcm search -k resource

# Filter by type
fcm search -t Extension patient

# Search in specific package
fcm search patient --package hl7.fhir.us.core

# Output as JSON
fcm search patient --json
```

#### Output Format
Default (single-line per result):
```
Found 20 resources matching "str def pati":
http://hl7.org/fhir/StructureDefinition/Patient, {"resourceType":"StructureDefinition","kind":"resource","type":"Patient","package":"hl7.fhir.r4.core"}
http://hl7.org/fhir/StructureDefinition/patient-animal, {"resourceType":"StructureDefinition","kind":"complex-type","type":"Extension","package":"hl7.fhir.r4.core"}
...
```

### fcm resolve

Resolve a canonical URL to its full resource.

**Location:** [src/cli/resolve.ts](../src/cli/resolve.ts)

#### Syntax
```bash
fcm resolve <canonical-url> [options]
```

#### Options
| Option | Description |
|--------|-------------|
| `--fields <fields>` | Comma-separated list of fields to extract |

#### Examples
```bash
# Resolve and display full resource
fcm resolve http://hl7.org/fhir/StructureDefinition/Patient

# Extract specific fields
fcm resolve http://hl7.org/fhir/StructureDefinition/Patient --fields resourceType,url,name

# Resolve ValueSet
fcm resolve http://hl7.org/fhir/ValueSet/administrative-gender
```

#### Output
Returns the full JSON resource or selected fields:
```json
{
  "resourceType": "StructureDefinition",
  "url": "http://hl7.org/fhir/StructureDefinition/Patient",
  "name": "Patient",
  "kind": "resource",
  "abstract": false,
  ...
}
```

## CLI Implementation Details

### Main Entry Point
**Location:** [src/cli/index.ts](../src/cli/index.ts)

The main CLI router that:
1. Parses command-line arguments using `parseArgs()`
2. Routes to appropriate command handler
3. Handles global options (--help, --version)
4. Manages error handling and exit codes

### Argument Parser
**Location:** [src/cli/index.ts:91-156](../src/cli/index.ts#L91-L156)

The `parseArgs()` function:
- Separates positional arguments from options
- Handles short aliases (-sd, -cs, -vs)
- Supports both single and double dash options
- Returns structured `{positional, options}` object

### Configuration Loading
**Location:** [src/cli/index.ts:158-184](../src/cli/index.ts#L158-L184)

Functions for package.json management:
- `loadPackageJson()` - Reads and parses package.json
- `getConfigFromPackageJson()` - Extracts FCM configuration

### Error Handling

All CLI commands implement consistent error handling:
1. User-friendly error messages to stderr
2. Appropriate exit codes (0 for success, 1 for error)
3. In test mode (`NODE_ENV=test`), throws errors instead of exiting

**Location:** [src/cli/search.ts:18-21](../src/cli/search.ts#L18-L21)

Example:
```typescript
if (!packageJson?.fcm?.packages) {
  console.error("Error: No FHIR packages configured");
  console.error("Run 'fcm init' first to initialize packages");
  if (process.env.NODE_ENV === 'test') {
    throw new Error("No FHIR packages configured");
  }
  process.exit(1);
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Set to 'test' to prevent process.exit() in tests |
| `HOME` | Overridden during Bun package installation to bypass auth |
| `NPM_CONFIG_USERCONFIG` | Set to /dev/null for Bun to prevent .npmrc loading |

## File System Usage

The CLI creates and manages these directories:
- `.fcm/cache/` - Cache storage
- `node_modules/` - Installed FHIR packages
- `package.json` - Project configuration
- `package-lock.json` or `bun.lock` - Lock file for dependencies