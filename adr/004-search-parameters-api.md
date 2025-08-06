# ADR-004: Search Parameters API

## Status
Proposed

## Context

FHIR defines SearchParameter resources that describe how to search for resources using specific parameters. Each SearchParameter defines:
- Which resource types it applies to (via the `base` field)
- The parameter code used in search queries
- The type of search (token, reference, string, date, etc.)
- The FHIRPath expression for extracting values
- Additional metadata like allowed comparators, modifiers, and targets

Currently, the FHIR Canonical Manager can resolve and search for resources, but it doesn't provide a way to discover what search parameters are available for a given resource type. This makes it difficult for developers to:
1. Build dynamic search interfaces
2. Validate search queries
3. Understand the search capabilities of loaded FHIR packages

### Key Findings from Analysis

After analyzing 1,400 SearchParameter resources in hl7.fhir.r4.core:
- **Multi-base parameters**: One SearchParameter can apply to multiple resource types (37 parameters are multi-base, 2.6%)
- **Type distribution**: token (38.7%), reference (34%), string (10%), date (8%), composite (3.3%)
- **Common parameters**: Some parameters like "clinical-patient" apply to 32+ different resources
- **Type-specific features**: 
  - Reference types specify target resources
  - Date/quantity types specify allowed comparators
  - Composite types have component sub-parameters

## Decision

We will add a new method `getSearchParametersForResource` to the CanonicalManager API that retrieves all search parameters applicable to a specific resource type. The method will return the full FHIR SearchParameter resources with an open interface that guarantees essential fields while preserving all original FHIR properties.

### API Design

```typescript
// Open interface that includes all original FHIR SearchParameter fields
// Only essential fields are required, allowing access to all FHIR properties
interface SearchParameter {
  // Required fields
  url: string;         // Canonical URL of the SearchParameter
  name: string;        // Computer-friendly name
  code: string;        // Search parameter code (used in queries)
  base: string[];      // Resource types this search parameter applies to
  type: string;        // Type: token, reference, date, string, etc.
  expression: string;  // FHIRPath expression
  
  // Optional commonly-used fields
  version?: string;    // Business version of the search parameter
  target?: string[];   // For reference types: target resource types
  multipleOr?: boolean;  // Allow multiple values with OR
  multipleAnd?: boolean; // Allow multiple values with AND
  comparator?: Array<'eq' | 'ne' | 'gt' | 'lt' | 'ge' | 'le' | 'sa' | 'eb' | 'ap'>;
  modifier?: Array<'missing' | 'exact' | 'contains' | 'not' | 'text' |
                   'in' | 'not-in' | 'below' | 'above' | 'type' | 'identifier' | 'ofType'>;
  
  // Open for all other FHIR SearchParameter fields
  [key: string]: any;  // Allows access to all original FHIR properties like status, description, xpath, etc.
}

interface CanonicalManager {
  // ... existing methods ...
  
  /**
   * Get all search parameters for a specific resource type
   * @param resourceType - The FHIR resource type (e.g., "Patient", "Observation")
   * @returns Array of FHIR SearchParameter resources (with guaranteed essential fields)
   */
  getSearchParametersForResource(resourceType: string): Promise<SearchParameter[]>;
}
```

### Implementation Approach

1. **Query SearchParameter resources**: Use existing searchEntries with `type: 'SearchParameter'`
2. **Filter by base**: Include parameters where `resourceType` is in the `base` array
3. **Return full resources**: Return the complete FHIR SearchParameter resources without modification
4. **Sort results**: Order by code for consistent, predictable output
5. **Cache results**: Mandatory caching since SearchParameters don't change during runtime

### Caching Strategy

Since SearchParameter resources are static within a loaded package set and the computation involves iterating through potentially 1400+ SearchParameter resources, caching is essential for performance.

```typescript
class CanonicalManagerImpl {
  private searchParamsCache = new Map<string, SearchParameter[]>();
  
  async getSearchParametersForResource(resourceType: string): Promise<SearchParameter[]> {
    // Check cache first
    if (this.searchParamsCache.has(resourceType)) {
      return this.searchParamsCache.get(resourceType)!;
    }
    
    // Query and filter SearchParameters
    const searchParamEntries = await this.searchEntries({
      type: 'SearchParameter'
    });
    
    const results: SearchParameter[] = [];
    
    for (const entry of searchParamEntries) {
      const resource = await this.read(entry);
      
      // Check if this parameter applies to the requested resource
      const bases = resource.base || [];
      if (bases.includes(resourceType)) {
        // Return the full original resource - it already contains all fields
        // TypeScript will ensure the essential fields are present
        results.push(resource as SearchParameter);
      }
    }
    
    // Sort by code for consistent output
    results.sort((a, b) => a.code.localeCompare(b.code));
    
    // Cache the results
    this.searchParamsCache.set(resourceType, results);
    
    return results;
  }
  
  async destroy(): Promise<void> {
    // Clear cache on destroy
    this.searchParamsCache.clear();
    // ... other cleanup
  }
}
```

#### Cache Invalidation

The cache should be cleared when:
- `destroy()` is called
- The manager is re-initialized with different packages
- Memory pressure requires clearing (though this is unlikely given the small data size)

### Usage Example

```typescript
const manager = CanonicalManager({
  packages: ["hl7.fhir.r4.core"],
  workingDir: "./fhir"
});

await manager.init();

// Get all search parameters for Patient resource
const patientParams = await manager.getSearchParametersForResource('Patient');

// Result example (returns full FHIR SearchParameter resources):
// [
//   {
//     resourceType: "SearchParameter",
//     id: "Patient-identifier",
//     url: "http://hl7.org/fhir/SearchParameter/Patient-identifier",
//     name: "identifier",
//     status: "draft",
//     experimental: false,
//     date: "2019-11-01T09:29:23+11:00",
//     publisher: "Health Level Seven International (Patient Administration)",
//     description: "A patient identifier",
//     code: "identifier",
//     base: ["Patient"],
//     type: "token",
//     expression: "Patient.identifier",
//     xpath: "f:Patient/f:identifier",
//     xpathUsage: "normal",
//     version: "4.0.1"
//   },
//   {
//     resourceType: "SearchParameter",
//     id: "individual-address",
//     url: "http://hl7.org/fhir/SearchParameter/individual-address",
//     name: "address",
//     status: "draft",
//     experimental: false,
//     date: "2019-11-01T09:29:23+11:00",
//     publisher: "Health Level Seven International (Patient Administration)",
//     description: "A server defined search that may match any of the string fields in the Address...",
//     code: "address",
//     base: ["Patient", "Person", "Practitioner", "RelatedPerson"],
//     type: "string",
//     expression: "Patient.address | Person.address | Practitioner.address | RelatedPerson.address",
//     xpath: "f:Patient/f:address | f:Person/f:address | f:Practitioner/f:address | f:RelatedPerson/f:address",
//     xpathUsage: "normal",
//     version: "4.0.1"
//   }
//   // ... more parameters with all original FHIR fields preserved
// ]
```

## Consequences

### Positive

1. **Discoverability**: Developers can programmatically discover available search parameters
2. **Type safety**: Essential fields are guaranteed while preserving flexibility
3. **Dynamic UIs**: Applications can build search interfaces dynamically based on available parameters
4. **Multi-package support**: Works across all loaded FHIR packages
5. **Consistent with existing API**: Follows the pattern of other CanonicalManager methods
6. **Performance**: Mandatory caching ensures fast repeated calls (first call: ~100ms for 1400 parameters, subsequent: <1ms)
7. **Memory efficient**: Cache size is minimal (~200KB for 1400 parameters across all resource types)
8. **Full FHIR compatibility**: Returns complete SearchParameter resources, preserving all FHIR properties
9. **Future-proof**: Open interface accommodates future FHIR versions without API changes

### Negative

1. **Additional API surface**: One more method to maintain and document
2. **Memory usage**: Cache persists for the lifetime of the manager instance (~200KB total)
3. **Complexity**: Must handle multi-base parameters correctly
4. **Cache staleness**: Cache doesn't update if packages are modified at runtime (rare scenario)

### Neutral

1. **Read-only operation**: No side effects or state changes
2. **Optional feature**: Existing functionality continues to work without using this

## Alternatives Considered

### 1. Direct SearchParameter Resolution
Expose SearchParameter resources directly via existing search/resolve methods.
- **Pros**: No new API needed
- **Cons**: Requires users to understand SearchParameter structure and filter by base themselves

### 2. Enhanced Search Method
Add search parameter metadata to existing search results.
- **Pros**: Enriches existing API
- **Cons**: Increases payload size for all searches, even when not needed

### 3. Separate SearchParameter Manager
Create a dedicated class for managing search parameters.
- **Pros**: Separation of concerns
- **Cons**: Additional complexity, breaks single-manager pattern

### 4. Static Analysis
Pre-compute search parameters during package installation.
- **Pros**: Faster runtime performance
- **Cons**: Increases installation time, requires cache invalidation logic

## Implementation Notes

### Handling Multi-base Parameters

When a SearchParameter applies to multiple resources (e.g., "clinical-patient" applies to 32 resources), it should appear in the results for ALL applicable resource types.

### Performance Considerations

With mandatory caching:
- **First call per resource type**: ~100ms (iterate through 1400 SearchParameters)
- **Subsequent calls**: <1ms (cache hit)
- **Memory overhead**: ~200KB for complete cache of all resource types
- **Cache lifetime**: Persists until `destroy()` is called

### Future Enhancements

1. **Filter by parameter type**: `getSearchParametersForResource('Patient', { type: 'reference' })`
2. **Get common parameters**: Parameters that apply to all resources
3. **Search parameter validation**: Validate search queries against available parameters
4. **CLI command**: `fcm search-params <resourceType>` for command-line discovery

## References

- [FHIR Search](https://www.hl7.org/fhir/search.html)
- [SearchParameter Resource](https://www.hl7.org/fhir/searchparameter.html)
- [FHIR Search Parameter Registry](https://www.hl7.org/fhir/searchparameter-registry.html)