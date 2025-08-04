# Cache API

Provides in-memory and persistent caching for FHIR resource indexes.

## Import

```typescript
// Internal module - not directly exported
// Used internally by CanonicalManager
```

## Core Functions

### `createCache(packages, index): CacheContent`

Creates a new cache instance.

```typescript
const cache = createCache(packages, index);
```

#### Parameters

```typescript
packages: PackageInfo[]   // Installed packages
index: IndexEntry[]       // Resource index entries
```

### `saveCache(workingDir, cache): Promise<void>`

Persists cache to disk.

```typescript
await saveCache('./fhir-cache', cache);
```

Saves to: `{workingDir}/.fcm/cache/index.json`

### `loadCache(workingDir): Promise<CacheContent | null>`

Loads cache from disk.

```typescript
const cache = await loadCache('./fhir-cache');
```

Returns `null` if cache doesn't exist or is invalid.

### `isCacheValid(workingDir, cache): Promise<boolean>`

Validates cache against current package state.

```typescript
const isValid = await isCacheValid('./fhir-cache', cache);
```

#### Validation Checks

1. **Version**: Cache format version matches
2. **Lock Hash**: package-lock.json hasn't changed
3. **Packages**: All cached packages still exist

### `computePackageLockHash(workingDir): Promise<string | null>`

Computes SHA256 hash of lock file.

```typescript
const hash = await computePackageLockHash('./fhir-cache');
```

Supports:
- `package-lock.json` (npm)
- `bun.lockb` (Bun binary)
- `bun.lock` (Bun text)

## Cache Structure

### `CacheContent`

```typescript
interface CacheContent {
  version: number;          // Cache format version (current: 2)
  created: string;          // ISO timestamp
  packages: PackageInfo[];  // Installed packages
  index: IndexEntry[];      // Resource index
  packageLockHash?: string; // Lock file hash for validation
}
```

### File Structure

```
{workingDir}/
├── .fcm/
│   └── cache/
│       └── index.json    # Cached index
├── package.json
├── package-lock.json     # or bun.lock
└── node_modules/
    └── ...FHIR packages
```

## Cache Lifecycle

### 1. Creation

```typescript
// During initialization
const packages = await scanPackages(workingDir);
const index = await buildIndex(packages);
const cache = createCache(packages, index);
```

### 2. Persistence

```typescript
// Save after building
await saveCache(workingDir, cache);
```

### 3. Loading

```typescript
// On next initialization
const cache = await loadCache(workingDir);
if (cache && await isCacheValid(workingDir, cache)) {
  // Use cached data
} else {
  // Rebuild cache
}
```

### 4. Invalidation

Cache is invalidated when:
- Package dependencies change (lock file modified)
- FHIR packages are added/removed
- Cache version is outdated

## Performance Characteristics

### Operations

- **Save**: ~100ms for 5,000 entries
- **Load**: ~50ms for 5,000 entries
- **Validation**: ~10ms

### Storage

- **Disk Size**: ~2MB for 5,000 entries (JSON)
- **Memory**: ~10MB in-memory representation

## Cache Invalidation Strategies

### Automatic Invalidation

```typescript
// Detected automatically
if (lockFileHash !== cache.packageLockHash) {
  console.log('Package dependencies have changed, rebuilding cache...');
  // Rebuild cache
}
```

### Manual Invalidation

```bash
# Delete cache directory
rm -rf .fcm/cache
```

## Error Handling

```typescript
try {
  const cache = await loadCache(workingDir);
  if (!cache) {
    // Cache doesn't exist - build new one
  }
} catch (error) {
  // Cache corrupted - rebuild
  console.error('Cache corrupted:', error);
}
```

## Usage Example

```typescript
// Internal usage within CanonicalManager
class CanonicalManager {
  async init() {
    // Try to load cache
    let cache = await loadCache(this.workingDir);
    
    // Validate cache
    if (cache && await isCacheValid(this.workingDir, cache)) {
      console.log('Using cached index');
      this.packages = cache.packages;
      this.index = cache.index;
    } else {
      // Build new cache
      console.log('Building new index...');
      this.packages = await scanPackages(this.workingDir);
      this.index = await buildIndex(this.packages);
      
      // Save cache
      cache = createCache(this.packages, this.index);
      await saveCache(this.workingDir, cache);
    }
  }
}
```

## Implementation Details

- **Location**: `src/cache/`
- **Format**: JSON with pretty printing
- **Compression**: None (for debuggability)
- **Concurrency**: Not safe for concurrent writes

## Cache Optimization Tips

1. **Pre-warm Cache**: Build cache during Docker image creation
2. **Share Cache**: Mount cache directory as volume
3. **CI Cache**: Preserve `.fcm/cache` between CI runs
4. **Version Lock**: Use exact package versions to maximize cache hits