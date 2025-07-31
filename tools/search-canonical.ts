#!/usr/bin/env bun

/**
 * FHIR Canonical Search Tool
 * 
 * Search for FHIR resources by canonical URL, type, or kind
 * 
 * Usage:
 *   bun tools/search-canonical.ts [options]
 * 
 * Options:
 *   --url <url>         Search by canonical URL (partial match supported)
 *   --type <type>       Search by resource type
 *   --kind <kind>       Search by resource kind
 *   --package <name>    Filter by package name
 *   --version <version> Filter by resource version
 *   --format <format>   Output format: json, table, csv (default: table)
 *   --limit <n>         Limit number of results (default: unlimited)
 *   --help              Show this help message
 * 
 * Examples:
 *   # Search for all Patient resources
 *   bun tools/search-canonical.ts --type StructureDefinition --url Patient
 *   
 *   # Search for all resources of kind "resource"
 *   bun tools/search-canonical.ts --kind resource
 *   
 *   # Search in a specific package
 *   bun tools/search-canonical.ts --package hl7.fhir.r4.core --type ValueSet
 *   
 *   # Export results as JSON
 *   bun tools/search-canonical.ts --type CodeSystem --format json > codesystems.json
 */

import { CanonicalManager } from '../src';
import type { IndexEntry } from '../src';

interface SearchOptions {
  url?: string;
  type?: string;
  kind?: string;
  package?: string;
  version?: string;
  format?: 'json' | 'table' | 'csv';
  limit?: number;
  help?: boolean;
}

function parseArgs(): SearchOptions {
  const args = process.argv.slice(2);
  const options: SearchOptions = {
    format: 'table'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--url':
        options.url = args[++i];
        break;
      case '--type':
        options.type = args[++i];
        break;
      case '--kind':
        options.kind = args[++i];
        break;
      case '--package':
        options.package = args[++i];
        break;
      case '--version':
        options.version = args[++i];
        break;
      case '--format':
        const format = args[++i];
        if (format === 'json' || format === 'table' || format === 'csv') {
          options.format = format;
        } else {
          console.error(`Invalid format: ${format}. Must be json, table, or csv`);
          process.exit(1);
        }
        break;
      case '--limit':
        const limitStr = args[++i];
        if (limitStr) {
          options.limit = parseInt(limitStr, 10);
          if (isNaN(options.limit)) {
            console.error('Invalid limit: must be a number');
            process.exit(1);
          }
        }
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        console.log('Use --help for usage information');
        process.exit(1);
    }
  }
  
  return options;
}

function showHelp(): void {
  console.log(`
FHIR Canonical Search Tool

Search for FHIR resources by canonical URL, type, or kind

Usage:
  bun tools/search-canonical.ts [options]

Options:
  --url <url>         Search by canonical URL (partial match supported)
  --type <type>       Search by resource type
  --kind <kind>       Search by resource kind
  --package <name>    Filter by package name
  --version <version> Filter by resource version
  --format <format>   Output format: json, table, csv (default: table)
  --limit <n>         Limit number of results (default: unlimited)
  --help              Show this help message

Examples:
  # Search for all Patient resources
  bun tools/search-canonical.ts --type StructureDefinition --url Patient

  # Search for all resources of kind "resource"
  bun tools/search-canonical.ts --kind resource

  # Search in a specific package
  bun tools/search-canonical.ts --package hl7.fhir.r4.core --type ValueSet

  # Export results as JSON
  bun tools/search-canonical.ts --type CodeSystem --format json > codesystems.json
`);
}

function formatTable(entries: IndexEntry[]): void {
  if (entries.length === 0) {
    console.log('No results found');
    return;
  }
  
  // Calculate column widths
  const cols = {
    url: Math.max(30, ...entries.map(e => e.url?.length || 0)),
    type: Math.max(15, ...entries.map(e => e.type?.length || 0)),
    kind: Math.max(10, ...entries.map(e => e.kind?.length || 0)),
    package: Math.max(20, ...entries.map(e => e.package?.name.length || 0))
  };
  
  // Header
  console.log(
    'URL'.padEnd(cols.url) + ' | ' +
    'Type'.padEnd(cols.type) + ' | ' +
    'Kind'.padEnd(cols.kind) + ' | ' +
    'Package'.padEnd(cols.package)
  );
  console.log('-'.repeat(cols.url + cols.type + cols.kind + cols.package + 9));
  
  // Rows
  entries.forEach(entry => {
    console.log(
      (entry.url || '').padEnd(cols.url) + ' | ' +
      (entry.type || '').padEnd(cols.type) + ' | ' +
      (entry.kind || '').padEnd(cols.kind) + ' | ' +
      (entry.package?.name || '').padEnd(cols.package)
    );
  });
  
  console.log(`\nTotal: ${entries.length} results`);
}

function formatCSV(entries: IndexEntry[]): void {
  console.log('URL,Type,Kind,Package,Version');
  entries.forEach(entry => {
    const fields = [
      entry.url || '',
      entry.type || '',
      entry.kind || '',
      entry.package?.name || '',
      entry.version || ''
    ];
    console.log(fields.map(f => `"${f.replace(/"/g, '""')}"`).join(','));
  });
}

function formatJSON(entries: IndexEntry[]): void {
  console.log(JSON.stringify(entries, null, 2));
}

async function main() {
  const options = parseArgs();
  
  if (options.help) {
    showHelp();
    process.exit(0);
  }
  
  // Initialize the manager
  const manager = CanonicalManager({
    packages: ['hl7.fhir.r4.core'],
    workingDir: './tmp/search-tool',
    registry: 'https://fs.get-ig.org/pkgs'
  });
  
  try {
    await manager.init();
    
    // Build search parameters
    const searchParams: any = {};
    
    if (options.type) searchParams.type = options.type;
    if (options.kind) searchParams.kind = options.kind;
    if (options.version) searchParams.version = options.version;
    
    // Handle package filter
    if (options.package) {
      const packages = await manager.packages();
      const pkg = packages.find(p => p.name === options.package);
      if (pkg) {
        searchParams.package = pkg;
      } else {
        console.error(`Package not found: ${options.package}`);
        console.log('Available packages:');
        packages.forEach(p => console.log(`  - ${p.name}@${p.version}`));
        process.exit(1);
      }
    }
    
    // Perform search
    let results = await manager.searchEntries(searchParams);
    
    // Filter by URL if provided (partial match)
    if (options.url) {
      const urlLower = options.url.toLowerCase();
      results = results.filter(entry => 
        entry.url?.toLowerCase().includes(urlLower)
      );
    }
    
    // Apply limit if specified
    if (options.limit && options.limit > 0) {
      results = results.slice(0, options.limit);
    }
    
    // Format output
    switch (options.format) {
      case 'json':
        formatJSON(results);
        break;
      case 'csv':
        formatCSV(results);
        break;
      case 'table':
      default:
        formatTable(results);
        break;
    }
    
    await manager.destroy();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the tool
main();