import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ResourceSource } from "../core/resource-index.js";
import { fileExists } from "../fs/index.js";

export function createDirectoryResourceSource(basePath: string): ResourceSource {
    return {
        read: (filename) => fs.readFile(path.join(basePath, filename), "utf-8"),
        has: (filename) => fileExists(path.join(basePath, filename)),
        async listFiles() {
            const entries = await fs.readdir(basePath, { withFileTypes: true });
            return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
        },
    };
}
