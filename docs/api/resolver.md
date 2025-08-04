# Resolver API

Resolves canonical URLs to FHIR resources with context-aware resolution.

## Import

```typescript
// Internal module - used via CanonicalManager
manager.resolve(url, options);
```

## Core Functions

### `resolveInContext(entries, url, context): IndexEntry | null`

Resolves a URL with optional context constraints.

```typescript
const entry = resolveInContext(
  allEntries,
  'http://hl7.org/fhir/StructureDefinition/Patient',
  { package: 'hl7.fhir.r4.core' }
);
```

#### Parameters

```typescript
entries: IndexEntry[]    // All indexed entries
url: string             // Canonical URL to resolve
context?: {             // Optional resolution context
  package?: string;     // Package name constraint
  version?: string;     // Version constraint
  sourceContext?: {     // Source resource context
    sourceUrl?: string;
    sourceVersion?: string;
  };
}
```

## Resolution Strategy

### 1. Direct URL Match

```typescript
// Find exact URL match
const matches = entries.filter(e => e.url === url);
```

### 2. Context Filtering

```typescript
// Apply package constraint
if (context?.package) {
  matches = matches.filter(e => 
    e.package?.name === context.package
  );
}

// Apply version constraint
if (context?.version) {
  matches = matches.filter(e =>
    e.version === context.version ||
    e.package?.version === context.version
  );
}
```

### 3. Result Selection

```typescript
// Return first match (deterministic)
return matches[0] || null;
```

## Resolution Contexts

### Package-Specific Resolution

```typescript
// Resolve from specific package
const entry = resolveInContext(
  entries,
  'http://hl7.org/fhir/StructureDefinition/Patient',
  { package: 'hl7.fhir.r4.core' }
);
```

### Version-Specific Resolution

```typescript
// Resolve specific version
const entry = resolveInContext(
  entries,
  'http://hl7.org/fhir/ValueSet/observation-status',
  { version: '4.0.1' }
);
```

### Source Context Resolution

```typescript
// Resolve relative to source
const entry = resolveInContext(
  entries,
  'http://example.org/Profile',
  {
    sourceContext: {
      sourceUrl: 'http://example.org/BaseProfile',
      sourceVersion: '1.0.0'
    }
  }
);
```

## Resolution Rules

### Priority Order

1. **Exact package match**: If package specified
2. **Version match**: If version specified
3. **First available**: No constraints

### Multiple Matches

When multiple resources have same URL:

```typescript
// Package priority
if (context?.package) {
  // Prefer specified package
  return matchFromPackage || firstMatch;
}

// Default: return first match
return matches[0];
```

## Usage Examples

### Basic Resolution

```typescript
// Simple resolution
const entry = resolveInContext(
  entries,
  'http://hl7.org/fhir/StructureDefinition/Patient'
);
```

### Package Disambiguation

```typescript
// Multiple packages may define same URL
// US Core extends R4 Patient
const r4Patient = resolveInContext(
  entries,
  'http://hl7.org/fhir/StructureDefinition/Patient',
  { package: 'hl7.fhir.r4.core' }
);

const usCorePatient = resolveInContext(
  entries,
  'http://hl7.org/fhir/StructureDefinition/us-core-patient',
  { package: 'hl7.fhir.us.core' }
);
```

### Version Resolution

```typescript
// Resolve specific FHIR version
const r4Resource = resolveInContext(
  entries,
  url,
  { version: '4.0.1' }
);

const r5Resource = resolveInContext(
  entries,
  url,
  { version: '5.0.0' }
);
```

## Error Handling

### Not Found

```typescript
const entry = resolveInContext(entries, url);
if (!entry) {
  throw new Error(`Cannot resolve canonical URL: ${url}`);
}
```

### Multiple Matches Warning

```typescript
if (matches.length > 1) {
  console.warn(
    `Multiple resources found for ${url}, using first match`
  );
}
```

## Context Inheritance

### Hierarchical Resolution

```typescript
// Future enhancement: resolve dependencies
function resolveWithDependencies(url: string, context: Context) {
  const entry = resolveInContext(entries, url, context);
  
  if (entry?.dependencies) {
    // Resolve dependencies in same context
    for (const depUrl of entry.dependencies) {
      resolveInContext(entries, depUrl, context);
    }
  }
}
```

## Performance

### Complexity

- **Time**: O(n) where n = number of entries
- **Space**: O(1) additional space

### Optimization Strategies

1. **Index by URL**: Pre-build URL → Entry map
2. **Package Index**: Separate indexes per package
3. **Cache Results**: Memoize frequent lookups

### Benchmarks

- **Direct match**: ~1ms for 5000 entries
- **Filtered match**: ~5ms for 5000 entries
- **Not found**: ~5ms (full scan)

## Advanced Features

### Wildcard Resolution (Future)

```typescript
// Resolve any version
resolveInContext(entries, url, { version: '*' });

// Resolve latest version
resolveInContext(entries, url, { version: 'latest' });
```

### Dependency Resolution (Future)

```typescript
// Resolve with dependencies
const resolved = resolveWithDependencies(url, {
  includeDependencies: true,
  maxDepth: 3
});
```

## Implementation Details

- **Location**: `src/resolver/`
- **Pure Function**: No side effects
- **Synchronous**: No async operations
- **Deterministic**: Same input → same output

## Resolution Examples

### FHIR Core Resources

```typescript
// Base specification resources
resolveInContext(entries, 'http://hl7.org/fhir/StructureDefinition/Patient');
resolveInContext(entries, 'http://hl7.org/fhir/ValueSet/observation-status');
resolveInContext(entries, 'http://hl7.org/fhir/CodeSystem/observation-status');
```

### Profile Resolution

```typescript
// Implementation guides and profiles
resolveInContext(
  entries,
  'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
  { package: 'hl7.fhir.us.core' }
);
```

### Extension Resolution

```typescript
// FHIR extensions
resolveInContext(
  entries,
  'http://hl7.org/fhir/StructureDefinition/patient-birthPlace'
);
```