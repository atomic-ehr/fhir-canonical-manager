import { parseArgs, loadPackageJson, getConfigFromPackageJson } from './index';
import { CanonicalManager } from '../index';

export async function searchCommand(args: string[]): Promise<void> {
  const { positional, options } = parseArgs(args);
  const searchPattern = positional[0] || '';
  const isJson = options.json === true;
  const typeFilter = options.type as string | undefined;
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
    
    if (typeFilter) {
      searchCriteria.resourceType = typeFilter;
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

    // Filter by URL pattern if provided
    if (searchPattern) {
      const pattern = searchPattern.toLowerCase();
      results = results.filter(entry => 
        entry.url?.toLowerCase().includes(pattern)
      );
    }

    if (isJson) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log("No resources found");
      } else {
        console.log(`Found ${results.length} resource${results.length === 1 ? '' : 's'}${searchPattern ? ` matching "${searchPattern}"` : ''}:`);
        
        results.forEach(resource => {
          console.log(`  ${resource.url}`);
          console.log(`    Type: ${resource.resourceType || resource.type}, Package: ${resource.package?.name}`);
        });
      }
    }
  } finally {
    await manager.destroy();
  }
}