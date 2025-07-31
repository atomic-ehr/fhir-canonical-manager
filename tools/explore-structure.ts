#!/usr/bin/env bun

/**
 * FHIR StructureDefinition Explorer Tool
 * 
 * Explore the elements of a FHIR StructureDefinition
 * 
 * Usage:
 *   bun tools/explore-structure.ts <canonical-url>
 * 
 * Example:
 *   bun tools/explore-structure.ts http://hl7.org/fhir/StructureDefinition/Observation
 */

import { CanonicalManager } from '../src';

interface ElementDefinition {
  id: string;
  path: string;
  min: number;
  max: string;
  short?: string;
  definition?: string;
  type?: Array<{ code: string }>;
  isSummary?: boolean;
  binding?: {
    strength: string;
    valueSet?: string;
  };
}

interface StructureDefinition {
  resourceType: string;
  url: string;
  name: string;
  status: string;
  kind: string;
  abstract: boolean;
  type: string;
  baseDefinition?: string;
  derivation?: string;
  snapshot?: {
    element: ElementDefinition[];
  };
  differential?: {
    element: ElementDefinition[];
  };
}

function formatElement(element: ElementDefinition, indent: number = 0): string {
  const prefix = '  '.repeat(indent);
  const cardinality = `[${element.min}..${element.max}]`;
  const types = element.type?.map(t => t.code).join(' | ') || '';
  const summary = element.isSummary ? ' Σ' : '';
  
  let output = `${prefix}${element.path} ${cardinality}${summary}`;
  if (types) {
    output += ` : ${types}`;
  }
  if (element.short) {
    output += ` - ${element.short}`;
  }
  
  return output;
}

function calculateIndent(path: string, basePath: string): number {
  if (path === basePath) return 0;
  const subPath = path.substring(basePath.length + 1);
  return subPath.split('.').length;
}

async function main() {
  const url = process.argv[2];
  
  if (!url) {
    console.error('Usage: bun tools/explore-structure.ts <canonical-url>');
    console.error('Example: bun tools/explore-structure.ts http://hl7.org/fhir/StructureDefinition/Observation');
    process.exit(1);
  }

  const manager = CanonicalManager({
    packages: ['hl7.fhir.r4.core'],
    workingDir: './tmp/explore-tool',
    registry: 'https://fs.get-ig.org/pkgs'
  });

  try {
    await manager.init();
    
    // Resolve the StructureDefinition
    console.log(`Resolving: ${url}`);
    const entry = await manager.resolve(url);
    
    if (entry.resourceType !== 'StructureDefinition') {
      console.error(`Resource at ${url} is not a StructureDefinition`);
      process.exit(1);
    }
    
    // Read the full resource
    const sd = await manager.read(entry) as unknown as StructureDefinition;
    
    console.log('\n' + '='.repeat(80));
    console.log(`StructureDefinition: ${sd.name}`);
    console.log(`URL: ${sd.url}`);
    console.log(`Type: ${sd.type}`);
    console.log(`Kind: ${sd.kind}`);
    if (sd.baseDefinition) {
      console.log(`Base: ${sd.baseDefinition}`);
    }
    console.log('='.repeat(80) + '\n');
    
    // Display elements from snapshot
    if (sd.snapshot?.element) {
      console.log('Elements:');
      console.log('-'.repeat(80));
      
      const rootPath = sd.type;
      let lastPath = '';
      
      sd.snapshot.element.forEach(element => {
        // Add spacing between major sections
        if (lastPath && !element.path.startsWith(lastPath + '.')) {
          const currentDepth = element.path.split('.').length;
          const lastDepth = lastPath.split('.').length;
          if (currentDepth <= 2 || currentDepth < lastDepth) {
            console.log();
          }
        }
        
        const indent = calculateIndent(element.path, rootPath);
        console.log(formatElement(element, indent));
        
        // Show binding information if present
        if (element.binding?.valueSet) {
          const bindingIndent = '  '.repeat(indent + 1);
          console.log(`${bindingIndent}Binding: ${element.binding.strength} to ${element.binding.valueSet}`);
        }
        
        lastPath = element.path;
      });
      
      console.log('\n' + '-'.repeat(80));
      console.log(`Total elements: ${sd.snapshot.element.length}`);
      
      // Summary of element types
      const summaryElements = sd.snapshot.element.filter(e => e.isSummary);
      console.log(`Summary elements: ${summaryElements.length}`);
      
      // Count required elements
      const requiredElements = sd.snapshot.element.filter(e => e.min > 0 && e.path !== rootPath);
      console.log(`Required elements: ${requiredElements.length}`);
      
      if (requiredElements.length > 0) {
        console.log('\nRequired elements:');
        requiredElements.forEach(element => {
          console.log(`  - ${element.path}`);
        });
      }
    } else {
      console.log('No snapshot available');
    }
    
    await manager.destroy();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();