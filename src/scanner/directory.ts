/**
 * Directory scanning functionality
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtendedCache } from "../cache.js";
import { isFhirPackage } from "../fs/index.js";
import { scanPackage } from "./package.js";

export const scanDirectory = async (cache: ExtendedCache, pwd: string): Promise<void> => {
    const nodeModulesPath = path.join(pwd, "node_modules");
    const entries = await fs.readdir(nodeModulesPath, { withFileTypes: true });
    const nonFhirPackages: string[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const fullPath = path.join(entry.parentPath, entry.name);

        if (entry.name.startsWith("@")) {
            const scopedEntries = await fs.readdir(fullPath, {
                withFileTypes: true,
            });
            for (const scopedEntry of scopedEntries) {
                if (!scopedEntry.isDirectory()) continue;

                const scopedPath = path.join(fullPath, scopedEntry.name);
                const packageName = `${entry.name}/${scopedEntry.name}`;

                if (await isFhirPackage(scopedPath)) {
                    await scanPackage(scopedPath, cache);
                } else {
                    nonFhirPackages.push(packageName);
                }
            }
        } else if (await isFhirPackage(fullPath)) {
            await scanPackage(fullPath, cache);
        } else {
            nonFhirPackages.push(entry.name);
        }
    }

    if (nonFhirPackages.length > 0) {
        console.warn(
            `Warning: The following packages appear to be FHIR-related but are missing FHIR metadata (.index.json or fhirVersions in package.json):\n  - ${nonFhirPackages.join("\n  - ")}`,
        );
    }
};
