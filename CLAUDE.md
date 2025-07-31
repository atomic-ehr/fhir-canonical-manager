---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.
- Use `./tmp` folder for temporary files and scripts

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";

// import .css files directly and it works
import './index.css';

import { createRoot } from "react-dom/client";

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md`.

## FHIR Canonical Search Tool

A command-line tool for searching FHIR resources by canonical URL, type, or kind using the CanonicalManager.

### Usage

```bash
bun tools/search-canonical.ts [options]
```

### Options

- `--url <url>` - Search by canonical URL (supports partial matching)
- `--type <type>` - Search by resource type (e.g., StructureDefinition, ValueSet)
- `--kind <kind>` - Search by resource kind (e.g., resource, datatype, primitive)
- `--package <name>` - Filter by package name
- `--version <version>` - Filter by resource version
- `--format <format>` - Output format: json, table, csv (default: table)
- `--limit <n>` - Limit number of results
- `--help` - Show help message

### Examples

#### Search for Patient-related resources
```bash
bun tools/search-canonical.ts --url Patient --limit 10
```

#### Find all StructureDefinitions
```bash
bun tools/search-canonical.ts --type StructureDefinition
```

#### Search for resources of kind "resource"
```bash
bun tools/search-canonical.ts --kind resource --limit 20
```

#### Export all ValueSets as JSON
```bash
bun tools/search-canonical.ts --type ValueSet --format json > valuesets.json
```

#### Search in a specific package
```bash
bun tools/search-canonical.ts --package @atomic-ehr/hl7.fhir.r4.core --type CodeSystem
```

#### Export as CSV for spreadsheet analysis
```bash
bun tools/search-canonical.ts --type StructureDefinition --format csv > structures.csv
```

### Output Formats

#### Table (default)
Displays results in a formatted table with columns for URL, Type, Kind, and Package.

#### JSON
Outputs the complete IndexEntry objects as JSON, useful for programmatic processing.

#### CSV
Exports data in CSV format with headers, suitable for importing into spreadsheets.

### Tips

- The `--url` option supports partial matching, so `--url Patient` will find all resources with "Patient" in their URL
- Combine multiple filters for more specific searches
- Use `--limit` to avoid overwhelming output when exploring
- The tool initializes CanonicalManager with packages from `node_modules` by default

## Task Management Framework

This project uses a task-based development approach. All development tasks are tracked in the `tasks/` directory using markdown files.

### Task Structure

```
tasks/
├── todo/          # Tasks that need to be done
├── in-progress/   # Tasks currently being worked on
└── done/          # Completed tasks
```

### Task File Format

Each task follows the naming convention: `NNN-task-description.md` (e.g., `001-implement-parser.md`)

### Task Template

```markdown
# Task: [Title]

## Priority
High | Medium | Low

## Description
What needs to be done

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Notes
Any additional context or dependencies
```

### Working with Tasks

1. **Creating a task**: Add a new `.md` file in `tasks/todo/`
2. **Starting work**: Move the file to `tasks/in-progress/`
3. **Completing**: Move to `tasks/done/` with completion notes
4. **Referencing**: Tasks should reference relevant ADRs and specs

### Current Focus

The project follows Architecture Decision Records (ADRs) in the `adr/` directory and specifications in the `spec/` directory. Always check these before implementing features.
