# File System API

Low-level file system utilities for FHIR package management.

## Import

```typescript
// Internal module - not directly exported
// Used internally by other modules
```

## Core Functions

### `fileExists(filePath): Promise<boolean>`

Checks if a file or directory exists.

```typescript
const exists = await fileExists('./package.json');
```

### `ensureDirectory(dir): Promise<void>`

Creates directory if it doesn't exist.

```typescript
await ensureDirectory('./fhir-cache/.fcm/cache');
```

Creates parent directories recursively if needed.

### `isFhirPackage(dir): Promise<boolean>`

Checks if directory contains a FHIR package.

```typescript
const isFhir = await isFhirPackage('./node_modules/hl7.fhir.r4.core');
```

#### Detection Criteria

```typescript
// Must have .index.json in package/ subdirectory
const indexPath = path.join(dir, 'package', '.index.json');
return fileExists(indexPath);
```

## Directory Operations

### Path Resolution

```typescript
// Resolve to absolute path
const absolutePath = path.resolve(workingDir, 'node_modules');

// Join path segments
const packagePath = path.join(nodeModules, packageName);
```

### Directory Creation

```typescript
// Create with parents
await fs.mkdir(dir, { recursive: true });

// Ensure exists
if (!await fileExists(dir)) {
  await ensureDirectory(dir);
}
```

## File Operations

### Reading Files

```typescript
// Read JSON file
const content = await fs.readFile(filePath, 'utf-8');
const data = JSON.parse(content);

// Read binary file
const buffer = await fs.readFile(filePath);
```

### Writing Files

```typescript
// Write JSON with formatting
await fs.writeFile(
  filePath,
  JSON.stringify(data, null, 2),
  'utf-8'
);

// Write binary data
await fs.writeFile(filePath, buffer);
```

### File Stats

```typescript
// Get file information
const stats = await fs.stat(filePath);
console.log(stats.size);      // File size
console.log(stats.mtime);     // Modified time
console.log(stats.isFile());  // Is regular file
console.log(stats.isDirectory()); // Is directory
```

## Error Handling

### Common Errors

```typescript
try {
  await fileExists(path);
} catch (error) {
  if (error.code === 'ENOENT') {
    // File not found
  } else if (error.code === 'EACCES') {
    // Permission denied
  } else if (error.code === 'EISDIR') {
    // Is a directory
  }
}
```

### Safe Operations

```typescript
// Safe read with fallback
async function safeRead(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

// Safe directory creation
async function safeEnsureDir(dir: string): Promise<boolean> {
  try {
    await ensureDirectory(dir);
    return true;
  } catch {
    return false;
  }
}
```

## Path Utilities

### Path Parsing

```typescript
const parsed = path.parse('/path/to/file.json');
// {
//   root: '/',
//   dir: '/path/to',
//   base: 'file.json',
//   ext: '.json',
//   name: 'file'
// }
```

### Path Joining

```typescript
// Platform-aware path joining
const fullPath = path.join(
  workingDir,
  'node_modules',
  packageName,
  'package',
  '.index.json'
);
```

### Relative Paths

```typescript
// Get relative path
const relative = path.relative(fromDir, toDir);

// Resolve to absolute
const absolute = path.resolve(workingDir, relative);
```

## Directory Structure

### Expected Layout

```
workingDir/
├── package.json
├── package-lock.json
├── node_modules/
│   └── [FHIR packages]
└── .fcm/
    └── cache/
        └── index.json
```

### Directory Traversal

```typescript
// Read directory contents
const entries = await fs.readdir(dir);

// With file types
const entriesWithTypes = await fs.readdir(dir, { withFileTypes: true });
for (const entry of entriesWithTypes) {
  if (entry.isDirectory()) {
    // Process subdirectory
  } else if (entry.isFile()) {
    // Process file
  }
}
```

## Usage Examples

### Package Detection

```typescript
async function findFhirPackages(nodeModules: string): Promise<string[]> {
  const packages: string[] = [];
  const entries = await fs.readdir(nodeModules, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const packagePath = path.join(nodeModules, entry.name);
      if (await isFhirPackage(packagePath)) {
        packages.push(entry.name);
      }
    }
  }
  
  return packages;
}
```

### Cache Management

```typescript
async function setupCache(workingDir: string) {
  const cacheDir = path.join(workingDir, '.fcm', 'cache');
  
  // Ensure directory exists
  await ensureDirectory(cacheDir);
  
  // Check for existing cache
  const cachePath = path.join(cacheDir, 'index.json');
  if (await fileExists(cachePath)) {
    return JSON.parse(await fs.readFile(cachePath, 'utf-8'));
  }
  
  return null;
}
```

### Safe File Operations

```typescript
async function safeWriteJson(filePath: string, data: any): Promise<void> {
  // Ensure parent directory exists
  const dir = path.dirname(filePath);
  await ensureDirectory(dir);
  
  // Write with temp file for atomicity
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
  await fs.rename(tempPath, filePath);
}
```

## Performance Considerations

### Async vs Sync

Always use async operations:

```typescript
// Good - non-blocking
await fileExists(path);

// Bad - blocks event loop
fs.existsSync(path);
```

### Batch Operations

```typescript
// Process files in parallel
const results = await Promise.all(
  paths.map(path => fileExists(path))
);
```

### Directory Listing

```typescript
// Efficient for large directories
const stream = fs.createReadStream(dir);
for await (const entry of stream) {
  // Process entry
}
```

## Platform Compatibility

### Path Separators

```typescript
// Use path.join for cross-platform
const crossPlatform = path.join('dir', 'subdir', 'file.txt');

// Don't hardcode separators
const bad = 'dir/subdir/file.txt';  // Unix only
const alsoBad = 'dir\\subdir\\file.txt';  // Windows only
```

### Line Endings

```typescript
// Handle different line endings
const normalized = content.replace(/\r\n/g, '\n');
```

## Implementation Details

- **Location**: `src/fs/`
- **Dependencies**: Node.js `fs/promises`, `path`
- **Error Handling**: Throws on errors
- **Async**: All operations are async