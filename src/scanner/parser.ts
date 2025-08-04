/**
 * Index file parsing and validation
 */

import type { IndexFile, IndexFileEntry } from '../types';

export const isValidFileEntry = (entry: any): boolean => {
  if (!entry || typeof entry !== "object") return false;
  if (!entry.filename || typeof entry.filename !== "string") return false;
  if (!entry.resourceType || typeof entry.resourceType !== "string")
    return false;
  if (!entry.id || typeof entry.id !== "string") return false;

  const optionalStringFields = ["url", "version", "kind", "type"];
  for (const field of optionalStringFields) {
    if (entry[field] !== undefined && typeof entry[field] !== "string") {
      return false;
    }
  }

  return true;
};

export const isValidIndexFile = (data: any): boolean => {
  if (!data || typeof data !== "object") return false;
  if (!data["index-version"] || typeof data["index-version"] !== "number")
    return false;
  if (!Array.isArray(data.files)) return false;
  return data.files.every((file: any) => isValidFileEntry(file));
};

export const parseIndex = (content: string, filePath: string): IndexFile | null => {
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