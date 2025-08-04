# Implementation Details

This document provides a deep dive into the core implementation of FHIR Canonical Manager.

## Core Data Structures

### Cache Structure
**Location:** [src/index.ts:260-341](../src/index.ts#L260-L341)

The cache is the heart of the system, maintaining all indexed data:

```typescript
{
  packageLockHash: string,        // SHA-256 hash for invalidation
  packages: {
    "hl7.fhir.r4.core": {
      id: { name: "...", version: "..." },
      path: "/path/to/package",
      canonical: "http://hl7.org/fhir",
      fhirVersions: ["4.0.1"]
    }
  },
  entries: {
    "http://hl7.org/fhir/StructureDefinition/Patient": [
      {
        id: "hash-based-id",
        url: "...",
        type: "Patient",
        resourceType: "StructureDefinition",
        kind: "resource",
        package: { name: "...", version: "..." }
      }
    ]
  },
  references: {
    "hash-based-id": {
      path: "StructureDefinition-Patient.json",
      package: { name: "...", version: "..." }
    }
  }
}
```

### Index File Format
**Location:** [src/index.ts:148-171](../src/index.ts#L148-L171)

FHIR packages include `.index.json` files:

```typescript
interface IndexFile {
  "index-version": number;
  files: Array<{
    filename: string;
    resourceType?: string;
    type?: string;
    id?: string;
    url?: string;
    version?: string;
    kind?: string;
    derivation?: string;
  }>;
}
```

## Key Algorithms

### Reference ID Generation
**Location:** [src/index.ts:239-258](../src/index.ts#L239-L258)

Generates deterministic IDs using SHA-256:

```typescript
generateId(params: {
  packageName: string;
  packageVersion: string;
  filePath: string;
}): string {
  const input = `${packageName}@${packageVersion}:${filePath}`;
  return createHash("sha256")
    .update(input)
    .digest("hex")
    .substring(0, 16);
}
```

**Purpose:**
- Ensures unique IDs across packages
- Enables deduplication
- Provides stable references

### Package Lock Hash Calculation
**Location:** [src/index.ts:545-570](../src/index.ts#L545-L570)

Calculates hash for cache invalidation:

```typescript
async function calculatePackageLockHash(workingDir: string): Promise<string | undefined> {
  // Try package-lock.json first
  const lockPath = path.join(workingDir, "package-lock.json");
  if (await fileExists(lockPath)) {
    const content = await fs.readFile(lockPath, "utf-8");
    return createHash("sha256").update(content).digest("hex");
  }
  
  // Try bun.lock
  const bunLockPath = path.join(workingDir, "bun.lock");
  if (await fileExists(bunLockPath)) {
    const content = await fs.readFile(bunLockPath);
    return createHash("sha256").update(content).digest("hex");
  }
  
  return undefined;
}
```

### Smart Search Algorithm
**Location:** [src/index.ts:887-973](../src/index.ts#L887-L973)

The smart search implementation:

1. **Tokenization:** Split search terms
2. **Normalization:** Convert to lowercase
3. **Expansion:** Apply abbreviation dictionary
4. **Matching:** Check each term against:
   - Direct prefix match on URL parts
   - Expanded abbreviation match
   - Substring match as fallback

```typescript
// Simplified algorithm
for (const term of searchTerms) {
  const urlParts = url.split(/[\/\-_\.\s]+/);
  
  // Direct prefix match
  if (urlParts.some(part => part.startsWith(term))) {
    return true;
  }
  
  // Abbreviation expansion
  const expansions = abbreviationDict[term] || [];
  for (const expansion of expansions) {
    if (urlParts.some(part => part.startsWith(expansion))) {
      return true;
    }
  }
  
  // Substring fallback
  return url.includes(term);
}
```

## Package Scanning Process

### Directory Traversal
**Location:** [src/index.ts:506-543](../src/index.ts#L506-L543)

Recursively scans node_modules:

```typescript
async function scanDirectory(dirPath: string, cache: Cache) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    
    if (entry.name.startsWith("@")) {
      // Scoped package directory
      await scanDirectory(path.join(dirPath, entry.name), cache);
    } else if (entry.name.startsWith("hl7.") || /* other FHIR patterns */) {
      // FHIR package
      await scanPackage(path.join(dirPath, entry.name), cache);
    }
  }
}
```

### Package Detection
**Location:** [src/index.ts:477-504](../src/index.ts#L477-L504)

Identifies FHIR packages by:
1. Package name patterns (hl7.*, fhir.*, us.*, ihe.*)
2. Presence of `.index.json`
3. Valid package.json structure

## Resource Resolution

### Multi-Package Handling
**Location:** [src/index.ts:764-794](../src/index.ts#L764-L794)

When multiple packages contain the same resource:

1. **Without context:** Returns first match
2. **With package specified:** Filters to that package
3. **With source context:** Attempts smart resolution

```typescript
if (entries.length > 1 && options?.sourceContext) {
  // Try to find best match based on context
  const contextMatch = entries.find(e => 
    e.package?.name === options.sourceContext?.sourceUrl
  );
  if (contextMatch) return contextMatch;
}
```

### File Reading
**Location:** [src/index.ts:807-831](../src/index.ts#L807-L831)

Efficient file reading with caching:

```typescript
async function read(reference: Reference): Promise<Resource> {
  const ref = cache.references[reference.id];
  if (!ref) throw new Error("Invalid reference");
  
  const pkg = cache.packages[ref.package.name];
  const filePath = path.join(pkg.path, ref.path);
  
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content);
}
```

## Performance Optimizations

### Lazy Initialization
**Location:** [src/index.ts:680-684](../src/index.ts#L680-L684)

The `ensureInitialized()` check:
```typescript
const ensureInitialized = () => {
  if (!initialized) {
    throw new Error("CanonicalManager not initialized. Call init() first.");
  }
};
```

### Batch Operations
**Location:** [src/index.ts:882-884](../src/index.ts#L882-L884)

Reading multiple resources:
```typescript
const resources = await Promise.all(
  entries.map((entry) => read(entry))
);
```

### Cache Persistence
**Location:** [src/index.ts:319-341](../src/index.ts#L319-L341)

Atomic cache writing:
```typescript
async function saveCache(workingDir: string, cache: Cache) {
  const cacheDir = path.join(workingDir, ".fcm", "cache");
  await fs.mkdir(cacheDir, { recursive: true });
  
  // Prepare serializable cache
  const serializableCache = {
    packageLockHash: cache.packageLockHash,
    packages: Object.values(cache.packages),
    entries: Object.entries(cache.entries).map(([url, entries]) => ({
      url,
      entries,
    })),
    references: Object.entries(cache.references).map(([id, ref]) => ({
      id,
      ...ref,
    })),
  };
  
  await fs.writeFile(
    path.join(cacheDir, "index.json"),
    JSON.stringify(serializableCache, null, 2)
  );
}
```

## Error Handling Patterns

### Silent Failures
**Location:** [src/index.ts:489-504](../src/index.ts#L489-L504)

Package scanning errors are logged but don't stop processing:
```typescript
try {
  await processIndex(packagePath, packageJson, cache);
} catch {
  // Silently ignore package scan errors
}
```

### User-Facing Errors
**Location:** [src/index.ts:772-776](../src/index.ts#L772-L776)

Clear error messages for API users:
```typescript
if (entries.length === 0) {
  throw new Error(
    `Canonical URL not found: ${canonicalUrl}`
  );
}
```

### Recovery Mechanisms
**Location:** [src/index.ts:286-300](../src/index.ts#L286-L300)

Cache loading with fallback:
```typescript
try {
  const cacheContent = await fs.readFile(cachePath, "utf-8");
  const savedCache = JSON.parse(cacheContent);
  // Validate and restore cache
} catch {
  // Return empty cache on error
  return createCache();
}
```

## Testing Considerations

### Test Mode Detection
**Location:** Various CLI files

Commands check for test environment:
```typescript
if (process.env.NODE_ENV === 'test') {
  throw new Error(message);  // Instead of process.exit()
}
```

### Temporary Directory Usage
Tests use `tmp/` folder (in .gitignore):
```typescript
const testDir = path.join(process.cwd(), "tmp", "test-" + Date.now());
```

## Security Considerations

### Registry Authentication Bypass
**Location:** [src/index.ts:396-401](../src/index.ts#L396-L401)

For Bun with FHIR registry:
```typescript
const env = {
  ...process.env,
  HOME: workingDir,  // Prevent reading user's .npmrc
  NPM_CONFIG_USERCONFIG: "/dev/null"  // Extra safety
};
```

### Input Validation
- Canonical URLs are validated as strings
- Package names follow NPM conventions
- File paths are resolved within working directory
- JSON parsing with try-catch blocks