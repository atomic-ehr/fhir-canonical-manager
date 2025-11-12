/**
 * Package manager detection
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type PackageManager = "bun" | "npm";

export async function detectPackageManager(): Promise<PackageManager | undefined> {
    try {
        await execAsync("bun --version");
        return "bun";
    } catch {
        try {
            await execAsync("npm --version");
            return "npm";
        } catch {
            return;
        }
    }
}
