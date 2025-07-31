import { parseArgs, loadPackageJson, getConfigFromPackageJson } from './index';
import { CanonicalManager } from '../index';

export async function resolveCommand(args: string[]): Promise<void> {
  const { positional, options } = parseArgs(args);
  const url = positional[0];
  const fields = options.fields as string | undefined;

  if (!url) {
    console.error("Error: Canonical URL required");
    console.error("Usage: fcm resolve <canonical-url> [--fields field1,field2]");
    console.error("Example: fcm resolve http://hl7.org/fhir/StructureDefinition/Patient");
    process.exit(1);
  }

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
    // Resolve the resource
    const resource = await manager.resolve(url);

    if (fields) {
      // Extract only specified fields
      const fieldList = fields.split(',').map(f => f.trim());
      const filtered: any = {};
      
      fieldList.forEach(field => {
        if (field in resource) {
          filtered[field] = resource[field];
        }
      });
      
      console.log(JSON.stringify(filtered, null, 2));
    } else {
      // Output full resource
      console.log(JSON.stringify(resource, null, 2));
    }
  } catch (error) {
    console.error(`Error: Resource not found: ${url}`);
    process.exit(1);
  } finally {
    await manager.destroy();
  }
}