# FHIR Canonical Manager Tools

This directory contains command-line tools built on top of the FHIR Canonical Manager.

## Available Tools

### search-canonical.ts

A powerful search tool for finding FHIR resources by their canonical URLs, types, or kinds.

**Quick Start:**
```bash
# Show help
bun tools/search-canonical.ts --help

# Search for Patient-related resources
bun tools/search-canonical.ts --url Patient

# Find all ValueSets
bun tools/search-canonical.ts --type ValueSet

# Export results as JSON
bun tools/search-canonical.ts --kind resource --format json > resources.json
```

**Features:**
- Search by partial URL match
- Filter by resource type or kind
- Multiple output formats (table, JSON, CSV)
- Package-specific searches
- Result limiting for exploration

See [CLAUDE.md](../CLAUDE.md#fhir-canonical-search-tool) for full documentation.

## Development

To create new tools:

1. Create a new TypeScript file in this directory
2. Import CanonicalManager from the parent package
3. Make the script executable with `#!/usr/bin/env bun`
4. Document the tool in CLAUDE.md

Example structure:
```typescript
#!/usr/bin/env bun

import { CanonicalManager } from '../src';

async function main() {
  const manager = new CanonicalManager();
  await manager.init();
  
  // Your tool logic here
  
  await manager.destroy();
}

main().catch(console.error);
```