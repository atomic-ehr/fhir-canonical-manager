import { parseArgs, loadPackageJson, getConfigFromPackageJson } from './index';
import { CanonicalManager } from '../index';

export async function searchCommand(args: string[]): Promise<void> {
  const { positional, options } = parseArgs(args);
  const searchTerms = positional; // Now support multiple search terms
  const isJson = options.json === true;
  const resourceTypeFilter = (options.type || options.resourceType) as string | undefined;
  const typeFilter = options.t as string | undefined;
  const kindFilter = options.k as string | undefined;
  const packageFilter = options.package as string | undefined;

  // Load config from package.json
  const packageJson = await loadPackageJson();
  if (!packageJson?.fcm?.packages || packageJson.fcm.packages.length === 0) {
    console.error("Error: No FHIR packages configured");
    console.error("Run 'fcm init' first to initialize packages");
    process.exit(1);
  }

  const config = getConfigFromPackageJson(packageJson);
  const manager = CanonicalManager(config as any);
  await manager.init();

  try {
    // Build search criteria
    const searchCriteria: any = {};
    
    // Handle kind filter through search criteria
    if (kindFilter) {
      searchCriteria.kind = kindFilter;
    }

    if (packageFilter) {
      const packages = await manager.packages();
      const pkg = packages.find(p => p.name === packageFilter);
      if (!pkg) {
        console.error(`Error: Package '${packageFilter}' not found`);
        process.exit(1);
      }
      searchCriteria.package = pkg;
    }

    // Search for resources
    let results = await manager.searchEntries(searchCriteria);

    // Filter by resourceType if specified
    if (resourceTypeFilter) {
      results = results.filter(entry => entry.resourceType === resourceTypeFilter);
    }

    // Filter by type if specified (e.g., Extension, Patient, Observation)
    if (typeFilter) {
      results = results.filter(entry => entry.type === typeFilter);
    }

    // Filter by URL pattern if provided
    if (searchTerms.length > 0) {
      // Convert search terms to lowercase for case-insensitive matching
      const terms = searchTerms.map(t => t.toLowerCase());
      
      results = results.filter(entry => {
        if (!entry.url) return false;
        const urlLower = entry.url.toLowerCase();
        
        // Check if all search terms match as prefixes in the URL
        return terms.every(term => {
          // Split the URL into parts (by /, -, _, .)
          const urlParts = urlLower.split(/[\/\-_\.]+/);
          // Check if any part starts with the search term
          return urlParts.some(part => part.startsWith(term));
        });
      });
    }

    if (isJson) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log("No resources found");
      } else {
        const searchInfo = searchTerms.length > 0 ? ` matching "${searchTerms.join(' ')}"` : '';
        console.log(`Found ${results.length} resource${results.length === 1 ? '' : 's'}${searchInfo}:`);
        
        results.forEach(resource => {
          const info = {
            resourceType: resource.resourceType,
            kind: resource.kind,
            type: resource.type,
            package: resource.package?.name
          };
          console.log(`${resource.url}, ${JSON.stringify(info)}`);
        });
      }
    }
  } finally {
    await manager.destroy();
  }
}