/**
 * Example usage of the new CanonicalManager API
 */

import { CanonicalManager } from './src';

async function main() {
  // Create and initialize the manager
  const cm = CanonicalManager({
    packages: ['hl7.fhir.r4.core'],
    workingDir: './tmp/example-fhir',
    registry: 'https://packages.simplifier.net'
  });
  
  await cm.init();
  
  try {
    // List available packages
    console.log('\n=== Available Packages ===');
    const packages = await cm.packages();
    packages.forEach(pkg => {
      console.log(`- ${pkg.name}@${pkg.version}`);
    });
    
    // Resolve a canonical URL
    console.log('\n=== Resolving Canonical URL ===');
    try {
      const resource = await cm.resolve('http://hl7.org/fhir/StructureDefinition/Patient');
      console.log('Resolved:', {
        id: resource.id,
        resourceType: resource.resourceType,
        url: resource.url,
        name: resource.name
      });
    } catch (e) {
      console.log('Patient StructureDefinition not found in installed packages');
    }
    
    // Search for resources
    console.log('\n=== Searching Resources ===');
    const searchResults = await cm.search({
      type: 'StructureDefinition'
    });
    console.log(`Found ${searchResults.length} StructureDefinitions`);
    
    if (searchResults.length > 0) {
      console.log('First 3 results:');
      searchResults.slice(0, 3).forEach(resource => {
        console.log(`- ${resource.url} (${resource.name})`);
      });
    }
    
    // Search within a specific package
    if (packages.length > 0) {
      const firstPackage = packages[0]!;
      console.log(`\n=== Searching in ${firstPackage.name} ===`);
      const packageResults = await cm.search({
        package: firstPackage
      });
      console.log(`Found ${packageResults.length} resources in ${firstPackage.name}`);
    }
    
  } finally {
    // Clean up
    await cm.destroy();
  }
}

// Run the example
main().catch(console.error);