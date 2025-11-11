/**
 * Package scanning functionality
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtendedCache } from "../cache.js";
import { fileExists } from "../fs/index.js";
import type { PackageInfo, PackageJson } from "../types/index.js";
import { processIndex } from "./processor.js";

export const scanPackage = async (packagePath: string, cache: ExtendedCache): Promise<void> => {
    try {
        const packageJsonPath = path.join(packagePath, "package.json");
        const packageJsonContent = await fs.readFile(packageJsonPath, "utf-8");
        const packageJson: PackageJson = JSON.parse(packageJsonContent);

        const packageInfo: PackageInfo = {
            id: { name: packageJson.name, version: packageJson.version },
            path: packagePath,
            canonical: packageJson.canonical,
            fhirVersions: packageJson.fhirVersions,
        };
        cache.packages[packageJson.name] = packageInfo;

        await processIndex(packagePath, packageJson, cache);

        const examplesPath = path.join(packagePath, "examples");
        if (await fileExists(path.join(examplesPath, ".index.json"))) {
            await processIndex(examplesPath, packageJson, cache);
        }
    } catch {
        // Silently ignore package scan errors
    }
};
