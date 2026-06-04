import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CanonicalManager } from "../../../src";

describe("packageIndex config resolution", () => {
    let workingDir: string;

    beforeEach(async () => {
        workingDir = await fs.mkdtemp(path.join(os.tmpdir(), "package-index-test-"));
    });

    afterEach(async () => {
        await fs.rm(workingDir, { recursive: true, force: true }).catch(() => {});
    });

    test("throws when both packageIndex and ignorePackageIndex are set", async () => {
        const manager = CanonicalManager({
            packages: [],
            workingDir,
            packageIndex: "use",
            ignorePackageIndex: true,
        });
        await expect(manager.init()).rejects.toThrow(/Cannot set both `packageIndex`/);
    });

    test("warns when the deprecated ignorePackageIndex is used", async () => {
        const warnings: string[] = [];
        const original = console.warn;
        console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
        try {
            const manager = CanonicalManager({ packages: [], workingDir, ignorePackageIndex: true });
            // The deprecation warning fires synchronously at the top of init(); tolerate any
            // later init hiccup (no packages installed) — we only assert the warning fired.
            await manager.init().catch(() => {});
        } finally {
            console.warn = original;
        }
        expect(warnings.some((w) => w.includes("ignorePackageIndex") && w.includes("deprecated"))).toBe(true);
    });

    test("does not warn about deprecation when only packageIndex is set", async () => {
        const warnings: string[] = [];
        const original = console.warn;
        console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
        try {
            const manager = CanonicalManager({ packages: [], workingDir, packageIndex: "recover" });
            await manager.init().catch(() => {});
        } finally {
            console.warn = original;
        }
        expect(warnings.some((w) => w.includes("ignorePackageIndex"))).toBe(false);
    });
});
