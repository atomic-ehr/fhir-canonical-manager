# Testing Guide

## Test Structure

The project uses Bun's built-in test runner with comprehensive test coverage across three main test files.

### Test Files

| File | Purpose | Location |
|------|---------|----------|
| `index.test.ts` | Core API tests | [test/index.test.ts](../test/index.test.ts) |
| `cli.test.ts` | CLI unit tests | [test/cli.test.ts](../test/cli.test.ts) |
| `cli-integration.test.ts` | CLI integration tests | [test/cli-integration.test.ts](../test/cli-integration.test.ts) |

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test test/index.test.ts

# Run tests in watch mode
bun test --watch

# Run with coverage
bun test --coverage
```

## Core API Tests

**Location:** [test/index.test.ts](../test/index.test.ts)

### Test Categories

#### 1. Initialization Tests
- Manager initialization
- Working directory creation
- Cache directory setup
- Package listing

#### 2. Resolution Tests
- Canonical URL resolution to IndexEntry
- Direct resource resolution
- Reference-based reading
- Error handling for missing resources

#### 3. Search Tests
- Basic search by type, kind, URL
- Package-filtered search
- Smart search with abbreviations
- Empty search handling

#### 4. Cache Tests
- Cache persistence
- Cache loading on re-init
- Cache invalidation on package-lock changes

### Example Test Structure

```typescript
describe("CanonicalManager", () => {
  let manager: CanonicalManager;
  const testWorkingDir = "./tmp/test-fhir";

  beforeEach(async () => {
    await fs.rm(testWorkingDir, { recursive: true, force: true })
      .catch(() => {});
    
    manager = CanonicalManager({
      packages: ["hl7.fhir.r4.core@4.0.1"],
      workingDir: testWorkingDir,
      registry: "https://fs.get-ig.org/pkgs/",
    });
  });

  test("should initialize successfully", async () => {
    await manager.init();
    expect(manager).toBeDefined();
  });
});
```

## CLI Unit Tests

**Location:** [test/cli.test.ts](../test/cli.test.ts)

### parseArgs Tests
Tests argument parsing logic:
- Short aliases (-sd, -cs, -vs)
- Multiple positional arguments
- Mixed arguments handling
- Option parsing (-t, -k)

### Search Output Tests
Tests search command output formatting:
- Single-line format
- JSON output
- Empty results handling
- Filter application

### Mock Environment Setup

```typescript
test("should output results in single-line format", async () => {
  const testDir = path.join(process.cwd(), "tmp", "test-search-" + Date.now());
  const originalCwd = process.cwd();
  const consoleOutput: string[] = [];
  const originalLog = console.log;
  
  // Mock console
  console.log = (...args) => consoleOutput.push(args.join(" "));
  
  try {
    // Setup test directory with mock data
    fs.mkdirSync(testDir, { recursive: true });
    
    // Create mock cache
    const mockIndex = {
      entries: { /* mock entries */ },
      references: { /* mock references */ }
    };
    
    fs.writeFileSync(
      path.join(testDir, ".fcm/cache/index.json"),
      JSON.stringify(mockIndex)
    );
    
    process.chdir(testDir);
    await searchCommand(["patient"]);
    
    // Verify output
    expect(consoleOutput.join("\n")).toContain("Found");
  } finally {
    console.log = originalLog;
    process.chdir(originalCwd);
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});
```

## CLI Integration Tests

**Location:** [test/cli-integration.test.ts](../test/cli-integration.test.ts)

### Test Approach
- Builds CLI using `bun run build`
- Executes CLI as subprocess
- Tests real package installation
- Verifies search functionality

### Example Integration Test

```typescript
test("fcm search with -sd shortcut", async () => {
  await ensureCLIBuilt();
  
  // Create test directory
  fs.mkdirSync(testDir, { recursive: true });
  
  // Create package.json with FCM config
  const packageJson = {
    name: "test-project",
    fcm: {
      packages: ["hl7.fhir.r4.core@4.0.1"],
      registry: "https://fs.get-ig.org/pkgs/",
    },
  };
  
  fs.writeFileSync(
    path.join(testDir, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );
  
  // Run CLI command
  const result = await $`cd ${testDir} && bun ${cliPath} search -sd Patient`.text();
  
  // Verify results
  expect(result).toContain("StructureDefinition");
  expect(result).toContain("Patient");
});
```

## Test Utilities

### File System Helpers

```typescript
// Check if file exists
const fileExists = async (path: string): Promise<boolean> => {
  return fs.access(path)
    .then(() => true)
    .catch(() => false);
};

// Clean test directory
const cleanup = () => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
};
```

### Mock Data Creation

```typescript
// Create mock package-lock.json
const createMockPackageLock = (testDir: string): string => {
  const content = JSON.stringify({ lockfileVersion: 2 }, null, 2);
  fs.writeFileSync(
    path.join(testDir, "package-lock.json"),
    content
  );
  return createHash('sha256').update(content).digest('hex');
};
```

## Test Environment

### Environment Variables
- `NODE_ENV=test` - Set automatically by Bun test runner
- Prevents `process.exit()` calls in CLI commands
- Enables error throwing for test assertions

### Temporary Files
- All test files created in `tmp/` directory
- Directory is in `.gitignore`
- Cleaned up after each test

### Test Isolation
- Each test creates its own working directory
- No shared state between tests
- Mock console output captured per test

## Performance Testing

### Benchmark Considerations
- Cache initialization time
- Search performance with large datasets
- File I/O operations
- Memory usage during indexing

### Example Performance Test

```typescript
test("should handle large package sets efficiently", async () => {
  const startTime = Date.now();
  
  await manager.init();
  const entries = await manager.searchEntries({});
  
  const duration = Date.now() - startTime;
  
  expect(entries.length).toBeGreaterThan(4000);
  expect(duration).toBeLessThan(5000); // Should init in < 5s
});
```

## Coverage Areas

### High Coverage
- Core API methods (100%)
- Cache operations
- Search algorithms
- CLI argument parsing

### Areas Needing Attention
- Error edge cases
- Network failures
- Concurrent operations
- Large file handling

## Best Practices

### 1. Test Organization
- Group related tests in describe blocks
- Use descriptive test names
- Keep tests focused and atomic

### 2. Mock Data
- Use minimal but realistic mock data
- Store complex mocks in separate files
- Generate dynamic test data when needed

### 3. Cleanup
- Always clean up test directories
- Restore mocked functions
- Reset process.cwd() if changed

### 4. Assertions
- Test both success and failure cases
- Verify data structure shapes
- Check for specific error messages

## Debugging Tests

### Run Single Test
```bash
bun test -t "should perform smart search"
```

### Debug Output
```typescript
console.log("Debug:", variable);
expect(variable).toBe(expected); // Will show diff
```

### Watch Mode Issues
- Tests use `tmp/` folder to avoid conflicts
- CLI tests throw errors instead of exiting
- File watchers ignore `.fcm/` and `node_modules/`