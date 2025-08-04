# Unit Tests for FHIR Canonical Manager

This directory contains comprehensive unit tests for all modules in the FHIR Canonical Manager, following the modular architecture defined in ADR-003.

## Test Structure

The test structure mirrors the source code structure:

```
test/unit/
├── reference/      # Reference management tests
├── fs/            # File system utilities tests
├── cache/         # Cache layer tests
├── scanner/       # Package scanning tests
├── resolver/      # Resolution engine tests
├── search/        # Search functionality tests
├── package/       # Package management tests
└── manager/       # Main manager tests (if needed)
```

## Test Coverage

### Reference Module (`reference/reference.test.ts`)
- **11 tests** covering:
  - Reference ID generation (consistency, uniqueness, URL-safety)
  - Reference storage and retrieval
  - URL-based reference tracking
  - Reference clearing and management
  - Reference object creation

### File System Module (`fs/fs.test.ts`)
- **13 tests** covering:
  - File existence checking
  - Directory creation (single and nested)
  - FHIR package detection
  - Error handling for permissions and invalid paths

### Cache Module (`cache/cache.test.ts`)
- **14 tests** covering:
  - Cache creation and independence
  - Package lock hash computation (package-lock.json and bun.lock)
  - Cache persistence to disk
  - Cache loading from disk
  - Round-trip data integrity
  - Error handling for invalid data

### Scanner Module (`scanner/scanner.test.ts`)
- **19 tests** covering:
  - Index file validation
  - JSON parsing and validation
  - Package index processing
  - Package scanning with examples
  - Directory traversal for packages
  - Scoped package support
  - Error handling for invalid packages

### Search Module (`search/search.test.ts`)
- **17 tests** covering:
  - Abbreviation expansion dictionary
  - Smart search filtering
  - Exact, prefix, and substring matching
  - Multi-term search (AND logic)
  - Case-insensitive search
  - Special character handling
  - Type and resourceType field matching

### Resolver Module (`resolver/resolver.test.ts`)
- **5 tests** covering:
  - Context-aware resolution
  - Package-specific resolution
  - Error handling for failed resolution
  - Option passing to resolve functions

### Package Module (`package/package.test.ts`)
- **5 tests** covering:
  - Package manager detection (bun/npm)
  - Package installation
  - package.json creation
  - Existing package.json preservation

## Running Tests

### Run all unit tests
```bash
bun test test/unit
```

### Run specific module tests
```bash
bun test test/unit/cache
bun test test/unit/search
bun test test/unit/scanner
```

### Run with coverage
```bash
bun test test/unit --coverage
```

### Run in watch mode
```bash
bun test test/unit --watch
```

## Test Statistics

- **Total Unit Tests**: 88
- **All Passing**: ✅
- **Test Execution Time**: ~200ms
- **Modules Covered**: 7/9 (types and constants don't need tests)

## Key Testing Patterns

1. **Isolation**: Each module is tested independently
2. **Mocking**: Minimal mocking, mostly testing real implementations
3. **Temp Directories**: File system tests use temporary directories
4. **Cleanup**: Proper cleanup in beforeEach/afterEach hooks
5. **Edge Cases**: Tests cover error conditions and edge cases
6. **Type Safety**: Full TypeScript type checking in tests

## Benefits of Modular Testing

1. **Fast Execution**: Unit tests run in ~200ms vs 9s for integration tests
2. **Better Isolation**: Issues are easier to locate
3. **Parallel Development**: Teams can work on different modules
4. **Confidence**: High coverage of individual components
5. **Maintainability**: Tests are organized and easy to find

## Future Improvements

- Add performance benchmarks for critical paths
- Add property-based testing for complex algorithms
- Add mutation testing to verify test quality
- Create test utilities for common patterns
- Add visual test coverage reports