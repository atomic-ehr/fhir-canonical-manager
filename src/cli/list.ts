import { parseArgs, loadPackageJson, getConfigFromPackageJson } from "./index.js";
import { CanonicalManager } from "../index.js";

export async function listCommand(args: string[]): Promise<void> {
    const { positional, options } = parseArgs(args);
    const packageName = positional[0];
    const isJson = options.json === true;
    const typeFilter = options.type as string | undefined;

    // Load config from package.json
    const packageJson = await loadPackageJson();
    if (!packageJson?.fcm?.packages || packageJson.fcm.packages.length === 0) {
        console.error("Error: No FHIR packages configured");
        console.error("Run 'fcm init' first to initialize packages");
        if (process.env.NODE_ENV === "test") {
            throw new Error("No FHIR packages configured");
        }
        process.exit(1);
    }

    const config = getConfigFromPackageJson(packageJson);
    const manager = CanonicalManager(config as any);
    await manager.init();

    try {
        if (!packageName) {
            // List all packages
            const packages = await manager.packages();

            if (isJson) {
                console.log(JSON.stringify(packages, null, 2));
            } else {
                console.log("Packages:");
                packages.forEach((pkg) => {
                    console.log(`  ${pkg.name}@${pkg.version}`);
                });
            }
        } else {
            // List resources in a specific package
            const packages = await manager.packages();
            const pkg = packages.find((p) => p.name === packageName);

            if (!pkg) {
                console.error(`Error: Package '${packageName}' not found`);
                console.error("Available packages:");
                packages.forEach((p) => console.error(`  - ${p.name}`));
                if (process.env.NODE_ENV === "test") {
                    throw new Error(`Package '${packageName}' not found`);
                }
                process.exit(1);
            }

            let resources = await manager.searchEntries({ package: pkg });

            // Apply type filter if specified
            if (typeFilter) {
                resources = resources.filter((r) => r.resourceType === typeFilter);
            }

            if (isJson) {
                console.log(JSON.stringify(resources, null, 2));
            } else {
                console.log(`Resources in ${packageName}:`);

                if (resources.length === 0) {
                    console.log("  No resources found");
                } else {
                    // Group by type
                    const byType = resources.reduce(
                        (acc, resource) => {
                            const type = resource.resourceType || resource.type || "Unknown";
                            if (!acc[type]) acc[type] = 0;
                            acc[type]++;
                            return acc;
                        },
                        {} as Record<string, number>,
                    );

                    // Show summary
                    Object.entries(byType)
                        .sort()
                        .forEach(([type, count]) => {
                            console.log(`  ${type}: ${count}`);
                        });

                    console.log(`\nTotal: ${resources.length} resources`);
                }
            }
        }
    } finally {
        await manager.destroy();
    }
}
