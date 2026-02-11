/**
 * File system utility functions
 */

import * as fs from "node:fs/promises";

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
