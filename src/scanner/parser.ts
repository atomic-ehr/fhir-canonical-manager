/**
 * Index file parsing and validation
 */

import type { IndexFile } from "../types/index.js";

export const isValidFileEntry = (entry: any): boolean => {
    if (!entry || typeof entry !== "object") return false;
    if (!entry.filename || typeof entry.filename !== "string") return false;
    if (!entry.resourceType || typeof entry.resourceType !== "string") return false;
    if (!entry.id || typeof entry.id !== "string") return false;

    // Optional fields can be undefined, null, or string
    const optionalStringFields = ["url", "version", "kind", "type"];
    for (const field of optionalStringFields) {
        if (entry[field] != null && typeof entry[field] !== "string") {
            return false;
        }
    }

    return true;
};

export const isValidIndexFile = (data: any): boolean => {
    if (!data || typeof data !== "object") return false;
    // Use == null to allow index-version: 0 (some packages like UK Core use version 0)
    if (data["index-version"] == null || typeof data["index-version"] !== "number") return false;
    if (!Array.isArray(data.files)) return false;
    return data.files.every((file: any) => isValidFileEntry(file));
};

export const parseIndex = (content: string, _filePath: string): IndexFile | null => {
    try {
        const data = JSON.parse(content);
        if (!isValidIndexFile(data)) {
            return null;
        }
        return data as IndexFile;
    } catch {
        return null;
    }
};
