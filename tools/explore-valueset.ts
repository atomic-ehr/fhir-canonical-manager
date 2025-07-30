#!/usr/bin/env bun

/**
 * FHIR ValueSet Explorer Tool
 * 
 * Explore the contents of a FHIR ValueSet
 * 
 * Usage:
 *   bun tools/explore-valueset.ts <canonical-url>
 * 
 * Example:
 *   bun tools/explore-valueset.ts http://hl7.org/fhir/ValueSet/administrative-gender
 */

import { CanonicalManager } from '../src';

interface ValueSet {
  resourceType: string;
  url: string;
  name: string;
  title?: string;
  status: string;
  description?: string;
  compose?: {
    include?: Array<{
      system?: string;
      version?: string;
      concept?: Array<{
        code: string;
        display: string;
        definition?: string;
      }>;
      filter?: Array<{
        property: string;
        op: string;
        value: string;
      }>;
    }>;
    exclude?: Array<any>;
  };
  expansion?: {
    timestamp: string;
    total?: number;
    contains: Array<{
      system?: string;
      code: string;
      display: string;
      abstract?: boolean;
    }>;
  };
}

async function main() {
  const url = process.argv[2];
  
  if (!url) {
    console.error('Usage: bun tools/explore-valueset.ts <canonical-url>');
    console.error('Example: bun tools/explore-valueset.ts http://hl7.org/fhir/ValueSet/administrative-gender');
    process.exit(1);
  }

  const manager = new CanonicalManager({
    logLevel: 'error'
  });

  try {
    await manager.init();
    
    // Resolve the ValueSet
    console.log(`Resolving: ${url}`);
    const entry = await manager.resolve(url);
    
    if (entry.resourceType !== 'ValueSet') {
      console.error(`Resource at ${url} is not a ValueSet`);
      process.exit(1);
    }
    
    // Read the full resource
    const vs = await manager.read(entry) as ValueSet;
    
    console.log('\n' + '='.repeat(80));
    console.log(`ValueSet: ${vs.name}`);
    if (vs.title) console.log(`Title: ${vs.title}`);
    console.log(`URL: ${vs.url}`);
    console.log(`Status: ${vs.status}`);
    if (vs.description) {
      console.log(`\nDescription: ${vs.description}`);
    }
    console.log('='.repeat(80) + '\n');
    
    // Display compose section
    if (vs.compose?.include) {
      console.log('Composed from:');
      vs.compose.include.forEach((include, index) => {
        if (include.system) {
          console.log(`\n${index + 1}. System: ${include.system}`);
          if (include.version) {
            console.log(`   Version: ${include.version}`);
          }
        }
        
        if (include.concept) {
          console.log('   Concepts:');
          include.concept.forEach(concept => {
            console.log(`   - ${concept.code}: ${concept.display}`);
            if (concept.definition) {
              console.log(`     Definition: ${concept.definition}`);
            }
          });
        }
        
        if (include.filter) {
          console.log('   Filters:');
          include.filter.forEach(filter => {
            console.log(`   - ${filter.property} ${filter.op} ${filter.value}`);
          });
        }
      });
    }
    
    // Display expansion if available
    if (vs.expansion?.contains) {
      console.log('\nExpanded values:');
      console.log('-'.repeat(80));
      
      const maxCodeLength = Math.max(...vs.expansion.contains.map(c => c.code.length));
      
      vs.expansion.contains.forEach(item => {
        const code = item.code.padEnd(maxCodeLength);
        const system = item.system ? ` (${item.system})` : '';
        console.log(`${code} - ${item.display}${system}`);
      });
      
      if (vs.expansion.total !== undefined) {
        console.log(`\nTotal: ${vs.expansion.total} concepts`);
      }
    }
    
    await manager.destroy();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();