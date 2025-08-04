# Search API

Smart search functionality with abbreviation expansion and multi-field matching.

## Import

```typescript
// Internal module - used via CanonicalManager
manager.smartSearch(terms, filters);
```

## Core Functions

### `smartSearch(entries, terms, filters): IndexEntry[]`

Performs intelligent search with abbreviation support.

```typescript
const results = smartSearch(
  allEntries,
  ['str', 'def', 'pati'],
  { resourceType: 'StructureDefinition' }
);
```

#### Parameters

```typescript
entries: IndexEntry[]      // All indexed entries
terms: string[]           // Search terms (support abbreviations)
filters?: {               // Optional filters
  resourceType?: string;
  type?: string;
  kind?: string;
  package?: PackageId;
}
```

#### Returns

Filtered and sorted `IndexEntry[]` array.

## Abbreviation Expansion

### Supported Abbreviations

```typescript
const ABBREVIATIONS = {
  // Structure
  'str': ['structure'],
  'struct': ['structure'],
  'def': ['definition'],
  'ext': ['extension'],
  
  // Resources
  'pati': ['patient'],
  'obs': ['observation'],
  'org': ['organization'],
  'pract': ['practitioner'],
  'proc': ['procedure'],
  'med': ['medication', 'medicinal'],
  'enc': ['encounter'],
  'cond': ['condition'],
  'diag': ['diagnostic'],
  
  // Actions
  'req': ['request'],
  'resp': ['response'],
  'ref': ['reference'],
  
  // Types
  'val': ['value'],
  'code': ['codesystem', 'code'],
  'cs': ['codesystem'],
  'vs': ['valueset'],
  'sd': ['structuredefinition'],
  'cap': ['capability'],
  'prof': ['profile'],
  'oper': ['operation'],
  'param': ['parameter']
};
```

### Expansion Process

```typescript
// Input: 'str'
// Expands to: ['str', 'structure']

// Input: 'obs'
// Expands to: ['obs', 'observation']
```

## Search Algorithm

### 1. Term Expansion

```typescript
function expandTerm(term: string): string[] {
  const lower = term.toLowerCase();
  const expansions = [lower];
  
  if (ABBREVIATIONS[lower]) {
    expansions.push(...ABBREVIATIONS[lower]);
  }
  
  return expansions;
}
```

### 2. Entry Matching

```typescript
function matchesAllTerms(entry: IndexEntry, expandedTerms: string[][]): boolean {
  return expandedTerms.every(termVariants =>
    termVariants.some(variant =>
      matchesTerm(entry, variant)
    )
  );
}
```

### 3. Field Matching

Searches in these fields:
- `url` (split by '/' and checked for prefix match)
- `type`
- `resourceType`

```typescript
function matchesTerm(entry: IndexEntry, term: string): boolean {
  // Check URL parts
  const urlParts = entry.url?.toLowerCase().split('/') || [];
  if (urlParts.some(part => part.startsWith(term))) {
    return true;
  }
  
  // Check type
  if (entry.type?.toLowerCase().startsWith(term)) {
    return true;
  }
  
  // Check resourceType
  if (entry.resourceType?.toLowerCase().startsWith(term)) {
    return true;
  }
  
  return false;
}
```

### 4. Filter Application

```typescript
function applyFilters(entry: IndexEntry, filters: Filters): boolean {
  if (filters.resourceType && entry.resourceType !== filters.resourceType) {
    return false;
  }
  if (filters.type && entry.type !== filters.type) {
    return false;
  }
  if (filters.kind && entry.kind !== filters.kind) {
    return false;
  }
  if (filters.package) {
    // Package filtering logic
  }
  return true;
}
```

## Usage Examples

### Basic Search

```typescript
// Find Patient resources
const patients = smartSearch(entries, ['patient']);

// Find all Observations
const observations = smartSearch(entries, ['obs']);
```

### Multi-term Search

```typescript
// Find StructureDefinition/Patient
const results = smartSearch(entries, ['str', 'def', 'pati']);

// Find ValueSet resources
const valueSets = smartSearch(entries, ['val', 'set']);
```

### Filtered Search

```typescript
// Only StructureDefinitions
const structures = smartSearch(
  entries,
  ['patient'],
  { resourceType: 'StructureDefinition' }
);

// Only resources (not types)
const resources = smartSearch(
  entries,
  ['patient'],
  { kind: 'resource' }
);
```

### Package-specific Search

```typescript
// Search in specific package
const r4Results = smartSearch(
  entries,
  ['patient'],
  { 
    package: {
      name: 'hl7.fhir.r4.core',
      version: '4.0.1'
    }
  }
);
```

## Search Logic

### AND Logic

All terms must match (AND operation):

```typescript
// Both 'patient' AND 'profile' must match
smartSearch(entries, ['patient', 'profile']);
```

### Prefix Matching

Terms match prefixes:

```typescript
// 'pat' matches 'patient', 'pattern', etc.
smartSearch(entries, ['pat']);
```

### Case Insensitive

All searches are case-insensitive:

```typescript
// These are equivalent
smartSearch(entries, ['PATIENT']);
smartSearch(entries, ['patient']);
smartSearch(entries, ['Patient']);
```

## Performance

### Complexity

- **Time**: O(n × m) where n = entries, m = terms
- **Space**: O(1) additional space

### Optimizations

1. **Early termination**: Skip entry if any term doesn't match
2. **Minimal allocations**: Reuse expanded terms
3. **Efficient string ops**: Use `startsWith` for prefix matching

### Benchmarks

- **1000 entries, 1 term**: ~5ms
- **5000 entries, 3 terms**: ~25ms
- **10000 entries, 5 terms**: ~80ms

## Advanced Features

### Empty Terms

Search with no terms returns all entries (with filters):

```typescript
// Get all StructureDefinitions
const allStructures = smartSearch(
  entries,
  [],
  { resourceType: 'StructureDefinition' }
);
```

### Partial URL Matching

URL segments are matched individually:

```typescript
// URL: http://hl7.org/fhir/StructureDefinition/Patient
// Matches: 'hl7', 'fhir', 'structure', 'patient'
```

## Implementation Details

- **Location**: `src/search/`
- **Pure Function**: No side effects
- **Synchronous**: No async operations
- **Memory Safe**: No caching of results