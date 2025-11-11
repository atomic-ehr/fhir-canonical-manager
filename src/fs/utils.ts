/**
 * File system utility functions
 */

import * as fs from "fs/promises";
import * as path from "path";

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
    return fileExists(indexPath);
};
