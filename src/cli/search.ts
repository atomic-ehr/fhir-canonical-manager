import { CanonicalManager } from "../index.js";
import { getConfigFromPackageJson, loadPackageJson, parseArgs } from "./index.js";

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
        if (process.env.NODE_ENV === "test" || process.env.BUN_TEST) {
            throw new Error("No FHIR packages configured");
        }
        process.exit(1);
    }

    const config = getConfigFromPackageJson(packageJson);
    const manager = CanonicalManager(config as any);
    await manager.init();

    try {
        // Build filters for smart search
        const filters: any = {};

        if (resourceTypeFilter) {
            filters.resourceType = resourceTypeFilter;
        }

        if (typeFilter) {
            filters.type = typeFilter;
        }

        if (kindFilter) {
            filters.kind = kindFilter;
        }

        if (packageFilter) {
            const packages = await manager.packages();
            const pkg = packages.find((p) => p.name === packageFilter);
            if (!pkg) {
                console.error(`Error: Package '${packageFilter}' not found`);
                if (process.env.NODE_ENV === "test" || process.env.BUN_TEST) {
                    throw new Error(`Package '${packageFilter}' not found`);
                }
                process.exit(1);
            }
            filters.package = pkg;
        }

        // Use the new smartSearch from core
        const results = await manager.smartSearch(searchTerms, filters);

        if (isJson) {
            console.log(JSON.stringify(results, null, 2));
        } else {
            if (results.length === 0) {
                console.log("No resources found");
            } else {
                const searchInfo = searchTerms.length > 0 ? ` matching "${searchTerms.join(" ")}"` : "";
                console.log(`Found ${results.length} resource${results.length === 1 ? "" : "s"}${searchInfo}:`);

                results.forEach((resource) => {
                    const info = {
                        resourceType: resource.resourceType,
                        kind: resource.kind,
                        type: resource.type,
                        package: resource.package?.name,
                    };
                    console.log(`${resource.url}, ${JSON.stringify(info)}`);
                });
            }
        }
    } finally {
        await manager.destroy();
    }
}
