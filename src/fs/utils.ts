/**
 * File system utility functions
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export const fileExists = async (filePath: string): Promise<boolean> => {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
};

export const ensureDir = async (dirPath: string): Promise<void> => {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch {
        // Ignore errors
    }
};

export const isFhirPackage = async (dirPath: string): Promise<boolean> => {
    const indexPath = path.join(dirPath, ".index.json");
    if (await fileExists(indexPath)) return true;

    const packageJsonPath = path.join(dirPath, "package.json");
    if (await fileExists(packageJsonPath)) {
        try {
            const content = await fs.readFile(packageJsonPath, "utf-8");
            const packageJson = JSON.parse(content);
            const withFhirVersion = Array.isArray(packageJson.fhirVersions) && packageJson.fhirVersions.length > 0;
            if (withFhirVersion) {
                console.warn(
                    `Warning: ${packageJson.name} does not have .index.json file. Resources will be scanned from directory (slower).`,
                );
                return true;
            }
        } catch {}
    }
    return false;
};
