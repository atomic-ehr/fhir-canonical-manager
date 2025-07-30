#!/usr/bin/env bun

/**
 * FHIR CodeSystem Explorer Tool
 * 
 * Explore the contents of a FHIR CodeSystem
 * 
 * Usage:
 *   bun tools/explore-codesystem.ts <canonical-url>
 * 
 * Example:
 *   bun tools/explore-codesystem.ts http://hl7.org/fhir/administrative-gender
 */

import { CanonicalManager } from '../src';

interface CodeSystem {
  resourceType: string;
  url: string;
  name: string;
  title?: string;
  status: string;
  description?: string;
  content: string;
  count?: number;
  concept?: Array<{
    code: string;
    display: string;
    definition?: string;
    concept?: Array<any>; // nested concepts
  }>;
}

function displayConcepts(concepts: any[], indent: number = 0) {
  const prefix = '  '.repeat(indent);
  concepts.forEach(concept => {
    console.log(`${prefix}- ${concept.code}: ${concept.display}`);
    if (concept.definition) {
      console.log(`${prefix}  Definition: ${concept.definition}`);
    }
    if (concept.concept) {
      displayConcepts(concept.concept, indent + 1);
    }
  });
}

async function main() {
  const url = process.argv[2];
  
  if (!url) {
    console.error('Usage: bun tools/explore-codesystem.ts <canonical-url>');
    console.error('Example: bun tools/explore-codesystem.ts http://hl7.org/fhir/administrative-gender');
    process.exit(1);
  }

  const manager = new CanonicalManager({
    logLevel: 'error'
  });

  try {
    await manager.init();
    
    // Resolve the CodeSystem
    console.log(`Resolving: ${url}`);
    const entry = await manager.resolve(url);
    
    if (entry.resourceType !== 'CodeSystem') {
      console.error(`Resource at ${url} is not a CodeSystem`);
      process.exit(1);
    }
    
    // Read the full resource
    const cs = await manager.read(entry) as CodeSystem;
    
    console.log('\n' + '='.repeat(80));
    console.log(`CodeSystem: ${cs.name}`);
    if (cs.title) console.log(`Title: ${cs.title}`);
    console.log(`URL: ${cs.url}`);
    console.log(`Status: ${cs.status}`);
    console.log(`Content: ${cs.content}`);
    if (cs.count) console.log(`Count: ${cs.count} concepts`);
    if (cs.description) {
      console.log(`\nDescription: ${cs.description}`);
    }
    console.log('='.repeat(80) + '\n');
    
    // Display concepts
    if (cs.concept) {
      console.log('Concepts:');
      displayConcepts(cs.concept);
    }
    
    await manager.destroy();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();