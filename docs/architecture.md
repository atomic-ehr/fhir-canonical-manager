# Architecture

## System Overview

FHIR Canonical Manager is built with a layered architecture that separates concerns between package management, resource indexing, caching, and API/CLI interfaces.

```
┌─────────────────────────────────────┐
│           CLI Interface             │
│         (src/cli/*.ts)              │
└─────────────────────────────────────┘
                 │
┌─────────────────────────────────────┐
│        CanonicalManager API         │
│         (src/index.ts)              │
└─────────────────────────────────────┘
                 │
┌─────────────────────────────────────┐
│    Core Components                  │
├─────────────────────────────────────┤
│ • Package Manager                   │
│ • Cache System                      │
│ • Index Processor                   │
│ • Reference Manager                 │
│ • Search Engine                     │
└─────────────────────────────────────┘
                 │
┌─────────────────────────────────────┐
│         File System                 │
│    (.fcm/cache/, node_modules/)    │
└─────────────────────────────────────┘
```

## Core Components

### 1. Package Manager Detection
**Location:** [src/index.ts:18-32](../src/index.ts#L18-L32)

Automatically detects available package manager (Bun or npm):
- Checks for Bun first (preferred for performance)
- Falls back to npm if Bun not available
- Used for package installation operations

### 2. Cache System
**Location:** [src/index.ts:260-341](../src/index.ts#L260-L341)

The cache system provides persistent storage of indexed FHIR resources:

#### Cache Structure
```typescript
interface Cache {
  packageLockHash?: string;  // Hash of package-lock for invalidation
  packages: Record<string, PackageInfo>;
  entries: Record<string, IndexEntry[]>;  // Canonical URL -> entries
  references: Record<string, Reference>;  // ID -> file reference
  referenceManager: ReferenceManager;
}
```

#### Key Functions
- `createCache()` - Initializes empty cache structure
- `loadCache()` - Loads from disk with validation
- `saveCache()` - Persists to `.fcm/cache/index.json`
- `clearCache()` - Removes cache directory

### 3. Reference Manager
**Location:** [src/index.ts:239-258](../src/index.ts#L239-L258)

Manages unique IDs for resources across packages:
- Generates deterministic IDs using SHA-256 hash
- Handles package disambiguation
- Enables efficient lookups

### 4. Index Processing
**Location:** [src/index.ts:423-475](../src/index.ts#L423-L475)

Processes FHIR package `.index.json` files:
- Parses index metadata
- Creates entry records
- Manages references to resource files
- Handles both main and examples directories

### 5. Package Installation
**Location:** [src/index.ts:343-427](../src/index.ts#L343-L427)

Installs FHIR packages from registry:
- Supports custom registries (default: https://fs.get-ig.org/pkgs/)
- Handles authentication bypass for Bun
- Creates minimal package.json if needed
- Ensures registry URLs end with '/'

### 6. Search Engine
**Location:** [src/index.ts:887-973](../src/index.ts#L887-L973)

Implements smart search with abbreviation support:

#### Smart Search Features
- Prefix matching on URL parts
- Abbreviation expansion (e.g., 'str' → 'structure')
- Multi-field search (URL, type, resourceType)
- Filter support (kind, type, resourceType, package)

#### Abbreviation Dictionary
```typescript
{
  'str': ['structure'],
  'def': ['definition'],
  'pati': ['patient'],
  'obs': ['observation'],
  // ... more abbreviations
}
```

## Data Flow

### Initialization Flow
1. User calls `manager.init()`
2. System detects package manager
3. Installs required packages if needed
4. Scans node_modules for FHIR packages
5. Processes `.index.json` files
6. Builds in-memory cache
7. Persists cache to disk

### Resolution Flow
1. User requests resource by canonical URL
2. System checks cache entries
3. Resolves to specific package/version if multiple
4. Reads resource file from disk
5. Returns parsed JSON resource

### Search Flow
1. User provides search terms
2. System tokenizes and normalizes terms
3. Expands abbreviations
4. Filters cached entries
5. Returns matching resources

## File System Layout

```
project/
├── .fcm/
│   └── cache/
│       └── index.json         # Persisted cache
├── node_modules/
│   ├── hl7.fhir.r4.core/
│   │   ├── package.json
│   │   ├── .index.json        # Package index
│   │   └── *.json            # Resource files
│   └── other-fhir-packages/
├── package.json              # Project config with fcm section
└── package-lock.json         # Lock file for cache invalidation
```

## Performance Optimizations

### 1. Lazy Loading
- Resources are only read from disk when requested
- Index processing happens once during initialization

### 2. Efficient Caching
- In-memory cache for fast lookups
- Persistent disk cache across sessions
- Automatic invalidation on package changes

### 3. Smart Indexing
- Canonical URLs as primary keys
- Reference IDs for deduplication
- Package-scoped lookups

### 4. Parallel Processing
- Concurrent package scanning
- Batch file operations where possible

## Error Handling

The system implements defensive error handling:
- Silent failures for missing packages (logged but not thrown)
- Graceful degradation when cache corrupted
- Clear error messages for user-facing operations
- Automatic recovery mechanisms

## Security Considerations

### Registry Authentication
- Bun: Bypasses auth by overriding HOME directory
- npm: Uses standard authentication flow
- No credentials stored in cache

### File System Access
- Scoped to working directory
- No execution of external code
- JSON parsing with error handling