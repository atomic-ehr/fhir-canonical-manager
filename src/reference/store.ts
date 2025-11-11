/**
 * Reference store implementation
 */

import { createHash } from "node:crypto";

export const generateReferenceId = (metadata: {
    packageName: string;
    packageVersion: string;
    filePath: string;
}): string => {
    const input = `${metadata.packageName}@${metadata.packageVersion}:${metadata.filePath}`;
    return createHash("sha256").update(input).digest("base64url");
};
