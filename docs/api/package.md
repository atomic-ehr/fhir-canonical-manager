# Package Manager API

Installs and manages NPM packages containing FHIR resources.

## Import

```typescript
// Internal module - used via CanonicalManager
// Handles package installation during init()
```

## Core Functions

### `installPackages(packages, workingDir, registry): Promise<void>`

Installs specified FHIR packages.

```typescript
await installPackages(
  ['hl7.fhir.r4.core@4.0.1'],
  './fhir-cache',
  'https://fs.get-ig.org/pkgs/'
);
```

#### Parameters

```typescript
packages: string[]       // Package specs (name@version)
workingDir: string      // Installation directory
registry?: string       // NPM registry URL
```

### `detectPackageManager(workingDir): Promise<'bun' | 'npm'>`

Detects available package manager.

```typescript
const pm = await detectPackageManager('./fhir-cache');
// Returns: 'bun' or 'npm'
```

#### Detection Logic

1. Check if `bun` command exists
2. Falls back to `npm` if not available

## Package Installation

### Package.json Creation

```typescript
// Creates minimal package.json
{
  "name": "fhir-canonical-manager-workspace",
  "version": "1.0.0",
  "private": true,
  "dependencies": {}
}
```

### Registry Configuration

#### FHIR Registry

```bash
# Uses --auth-type=legacy for FHIR registry
npm install --auth-type=legacy --registry=https://fs.get-ig.org/pkgs/
```

#### Custom Registry

```bash
# Standard npm registry
npm install --registry=https://custom-registry.com/
```

### Bun Installation

```bash
# Bun handles registries automatically
bun add hl7.fhir.r4.core@4.0.1
```

### NPM Installation

```bash
# NPM with registry config
npm install hl7.fhir.r4.core@4.0.1 --registry=...
```

## Package Specifications

### Format

```typescript
// Package@version
'hl7.fhir.r4.core@4.0.1'
'hl7.fhir.us.core@6.1.0'
'@custom/profiles@1.0.0'

// Latest version
'hl7.fhir.r4.core@latest'
'hl7.fhir.r4.core'  // Implies @latest
```

### Scoped Packages

```typescript
// NPM scoped packages
'@organization/package@1.0.0'
'@hl7/fhir-extensions@1.0.0'
```

## Error Handling

### Installation Failures

```typescript
try {
  await installPackages(packages, workingDir, registry);
} catch (error) {
  if (error.message.includes('ENOTFOUND')) {
    // Registry unreachable
  } else if (error.message.includes('E404')) {
    // Package not found
  } else if (error.message.includes('EACCES')) {
    // Permission denied
  }
}
```

### Common Issues

1. **Registry auth**: FHIR registry needs `--auth-type=legacy`
2. **Network proxy**: Configure npm/bun proxy settings
3. **Disk space**: Ensure sufficient space for packages
4. **Permissions**: Write access to working directory

## Package Structure

### Expected Layout

```
node_modules/
└── hl7.fhir.r4.core/
    ├── package.json
    └── package/
        ├── .index.json    # Required
        ├── StructureDefinition-Patient.json
        ├── ValueSet-observation-status.json
        └── ... (other resources)
```

### Package Validation

```typescript
function isValidFhirPackage(packagePath: string): boolean {
  // Must have .index.json
  const indexPath = path.join(packagePath, 'package', '.index.json');
  return fs.existsSync(indexPath);
}
```

## Usage Examples

### Basic Installation

```typescript
// Install single package
await installPackages(
  ['hl7.fhir.r4.core@4.0.1'],
  './fhir-cache'
);
```

### Multiple Packages

```typescript
// Install multiple packages
await installPackages(
  [
    'hl7.fhir.r4.core@4.0.1',
    'hl7.fhir.us.core@6.1.0',
    'hl7.fhir.uv.ips@1.1.0'
  ],
  './fhir-cache'
);
```

### Custom Registry

```typescript
// Use custom registry
await installPackages(
  packages,
  workingDir,
  'https://internal-registry.company.com/'
);
```

## Registry Configuration

### FHIR Registry

Default: `https://fs.get-ig.org/pkgs/`

Features:
- Official FHIR packages
- No authentication required
- Uses `--auth-type=legacy`

### NPM Registry

Alternative: `https://registry.npmjs.org/`

Features:
- Standard NPM packages
- May require authentication
- Larger selection

### Corporate Registry

```typescript
// Behind firewall
await installPackages(
  packages,
  workingDir,
  'https://nexus.company.com/repository/npm/'
);
```

## Performance

### Installation Time

- **Single package**: 5-30 seconds
- **Multiple packages**: 10-60 seconds
- **Cached packages**: <1 second

### Optimization Tips

1. **Use lock files**: Speeds up resolution
2. **Local cache**: npm/bun cache packages
3. **Parallel install**: Bun installs in parallel
4. **Exact versions**: Avoid version resolution

## Package Manager Comparison

### Bun

Advantages:
- Faster installation
- Binary lockfile
- Automatic registry handling
- Built-in TypeScript support

### NPM

Advantages:
- Universal availability
- Mature ecosystem
- Detailed logging
- Proxy support

## Implementation Details

- **Location**: `src/package/`
- **Child Process**: Uses `child_process.exec`
- **Working Directory**: Creates if not exists
- **Package.json**: Auto-generated if missing

## Security Considerations

1. **Registry validation**: Verify registry URL
2. **Package verification**: Check package signatures
3. **Dependency audit**: Run security audits
4. **Network security**: Use HTTPS registries
5. **Access control**: Limit write permissions