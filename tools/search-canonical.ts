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
 *   --resourceType <type> Alias for --type
 *   --kind <kind>       Search by resource kind
 *   --package <name>    Filter by package name
 *   --version <version> Filter by resource version
 *   --format <format>   Output format: json, table, csv (default: table)
 *   --limit <n>         Limit number of results (default: unlimited)
 *   --help              Show this help message
 * 
 * Short Aliases:
 *   -sd                 Short for --resourceType StructureDefinition
 *   -cs                 Short for --resourceType CodeSystem
 *   -vs                 Short for --resourceType ValueSet
 * 
 * Prefix Search:
 *   You can search using space-separated terms as positional arguments
 *   Example: bun tools/search-canonical.ts str def pat
 *   Matches: http://hl7.org/fhir/StructureDefinition/Patient
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
  resourceType?: string;
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

  // Check if there are positional arguments for prefix search
  const positionalArgs: string[] = [];
  let i = 0;
  
  // Collect positional arguments (non-option arguments)
  while (i < args.length) {
    if (args[i].startsWith('--') || args[i].startsWith('-')) {
      break;
    }
    positionalArgs.push(args[i]);
    i++;
  }
  
  // If we have positional args, treat them as prefix search terms
  if (positionalArgs.length > 0) {
    options.url = positionalArgs.join(' ');
  }

  for (; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '-sd':
        options.resourceType = 'StructureDefinition';
        break;
      case '-cs':
        options.resourceType = 'CodeSystem';
        break;
      case '-vs':
        options.resourceType = 'ValueSet';
        break;
      case '--url':
        options.url = args[++i];
        break;
      case '--type':
        options.type = args[++i];
        break;
      case '--resourceType':
        options.resourceType = args[++i];
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
  --resourceType <type> Alias for --type
  --kind <kind>       Search by resource kind
  --package <name>    Filter by package name
  --version <version> Filter by resource version
  --format <format>   Output format: json, table, csv (default: table)
  --limit <n>         Limit number of results (default: unlimited)
  --help              Show this help message

Short Aliases:
  -sd                 Short for --resourceType StructureDefinition
  -cs                 Short for --resourceType CodeSystem
  -vs                 Short for --resourceType ValueSet

Prefix Search:
  You can also search by providing space-separated search terms as positional arguments.
  Each term will be matched as a prefix against URL components.
  
  Example: bun tools/search-canonical.ts str def pat
  This will match URLs like:
    - http://hl7.org/fhir/StructureDefinition/Patient
    - http://hl7.org/fhir/StructureDefinition/PatientContact

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
  
  // Single line format
  entries.forEach(entry => {
    console.log(entry.url || '');
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
    
    if (options.type || options.resourceType) searchParams.type = options.type || options.resourceType;
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
      // Split the search term into parts for prefix matching
      const searchTerms = options.url.toLowerCase().split(/\s+/).filter(t => t.length > 0);
      
      results = results.filter(entry => {
        if (!entry.url) return false;
        const urlLower = entry.url.toLowerCase();
        
        // Check if all search terms match as prefixes in the URL
        return searchTerms.every(term => {
          // Split the URL into parts (by /, -, _, .)
          const urlParts = urlLower.split(/[\/\-_\.]+/);
          // Check if any part starts with the search term
          return urlParts.some(part => part.startsWith(term));
        });
      });
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