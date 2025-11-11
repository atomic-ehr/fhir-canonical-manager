/**
 * Package manager detection
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function detectPackageManager(): Promise<"bun" | "npm" | null> {
    try {
        // Check for bun first
        await execAsync("bun --version");
        return "bun";
    } catch {
        try {
            // Fall back to npm
            await execAsync("npm --version");
            return "npm";
        } catch {
            return null;
        }
    }
}
