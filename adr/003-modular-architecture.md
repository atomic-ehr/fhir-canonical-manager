# ADR-003: Modular Architecture Refactoring

## Status

Accepted - Implemented 2025-08-04

## Context

The current implementation of FHIR Canonical Manager has all core functionality in a single `src/index.ts` file containing 894 lines of code. This monolithic structure presents several challenges:

1. **Maintainability**: Difficult to navigate and understand specific functionality
2. **Testing**: Cannot unit test components in isolation
3. **Reusability**: Cannot import specific functionality without the entire codebase
4. **Team collaboration**: Multiple developers working on different features cause merge conflicts
5. **Code organization**: Mixed concerns make it hard to reason about the system architecture

The codebase has grown to include complex features like smart search, caching, package management, and resolution logic, all intertwined in a single file.

## Decision

Refactor the monolithic `index.ts` into a component-based architecture with clear separation of concerns. The system will be organized into 9 key components:

### Component Architecture

```
src/
├── types/              # Type definitions and interfaces
│   ├── core.ts        # Public API types
│   ├── internal.ts    # Internal implementation types
│   └── index.ts       # Type exports
│
├── reference/          # Reference management
│   ├── store.ts       # Reference store implementation
│   ├── manager.ts     # Reference manager factory
│   └── index.ts
│
├── cache/             # Caching layer
│   ├── core.ts        # Cache creation and management
│   ├── persistence.ts # Disk persistence
│   ├── validation.ts  # Cache validation logic
│   └── index.ts
│
├── package/           # Package management
│   ├── installer.ts   # Package installation
│   ├── detector.ts    # Package manager detection
│   └── index.ts
│
├── scanner/           # Package scanning and indexing
│   ├── processor.ts   # Index processing
│   ├── package.ts     # Package scanning
│   ├── directory.ts   # Directory traversal
│   └── index.ts
│
├── resolver/          # Resolution engine
│   ├── entry.ts       # Entry resolution
│   ├── context.ts     # Context-aware resolution
│   └── index.ts
│
├── search/            # Search functionality
│   ├── basic.ts       # Basic search operations
│   ├── smart.ts       # Smart search with abbreviations
│   ├── terms.ts       # Search term expansion
│   └── index.ts
│
├── fs/                # File system utilities
│   ├── utils.ts       # Basic FS operations
│   └── index.ts
│
├── manager/           # Main API orchestration
│   ├── canonical.ts   # CanonicalManager implementation
│   └── index.ts
│
├── constants.ts       # Shared constants
└── index.ts          # Public API exports
```

### Component Responsibilities

1. **Type System**: Domain model and type definitions
2. **Reference Manager**: Unique ID generation and URL mapping
3. **Cache Layer**: In-memory and persistent caching with validation
4. **Package Manager**: NPM/Bun package installation and detection
5. **Scanner**: FHIR package discovery and indexing
6. **Resolver**: Canonical URL to resource resolution
7. **Search System**: Basic and smart search capabilities
8. **File System**: Low-level file operations
9. **Canonical Manager**: API orchestration and lifecycle management

### Implementation Approach

1. **Phase 1**: Extract type definitions (no dependencies)
2. **Phase 2**: Extract utilities (reference manager, FS utils)
3. **Phase 3**: Extract core services (cache, scanner, resolver)
4. **Phase 4**: Extract features (search, package management)
5. **Phase 5**: Refactor main manager and update exports

Each phase will maintain backward compatibility and include comprehensive testing.

## Consequences

### Positive

- **Better Organization**: Each module has a single, clear responsibility
- **Improved Testing**: Components can be unit tested in isolation
- **Enhanced Maintainability**: Easier to locate and modify specific functionality
- **Reduced Coupling**: Clear interfaces between components
- **Better Documentation**: Each module can have focused documentation
- **Parallel Development**: Teams can work on different components without conflicts
- **Tree Shaking**: Users can import only needed functionality
- **Type Safety**: Cleaner import paths for types

### Negative

- **More Files**: Increases number of files from 1 to ~30
- **Import Complexity**: More import statements required
- **Initial Refactoring Effort**: Significant work to restructure existing code
- **Learning Curve**: Developers need to understand the new structure
- **Potential for Circular Dependencies**: Must be careful with module dependencies

## Alternatives Considered

### 1. Keep Monolithic Structure
- **Pros**: No refactoring needed, single file to understand
- **Cons**: Growing maintainability issues, poor testability
- **Rejected**: Current pain outweighs refactoring cost

### 2. Partial Extraction (3-4 modules)
- **Pros**: Less complexity than full modularization
- **Cons**: Still mixes concerns, doesn't fully solve the problem
- **Rejected**: Insufficient separation of concerns

### 3. Microservices Architecture
- **Pros**: Complete isolation, independent deployment
- **Cons**: Excessive for a library, performance overhead
- **Rejected**: Over-engineering for current needs

### 4. Plugin Architecture
- **Pros**: Extensible, dynamic loading
- **Cons**: Complex implementation, runtime overhead
- **Rejected**: Not needed for current use cases

## Migration Strategy

1. Create new module structure alongside existing index.ts
2. Gradually move functionality to new modules
3. Update existing index.ts to import from new modules
4. Maintain backward compatibility during migration
5. Update tests to use new module structure
6. Update documentation
7. Mark old exports as deprecated
8. Remove old code after deprecation period

## Success Metrics

- Unit test coverage increases to >90%
- Build time reduced by 20%
- New feature development velocity increases
- Reduced merge conflicts in team development
- Positive developer feedback on code organization

## References

- [Clean Architecture principles](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [SOLID principles](https://en.wikipedia.org/wiki/SOLID)
- [Component-based architecture](https://en.wikipedia.org/wiki/Component-based_software_engineering)
- Current implementation: `src/index.ts:1-894`