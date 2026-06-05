import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CanonicalManager } from "../../../src";
import { excludeCanonical } from "../../../src/patches";

describe("CM-level exclusion", () => {
    let root: string;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "exclusion-test-"));
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    });

    test("an excluded canonical is absent from the index and reported", async () => {
        const pkgPath = path.join(root, "pkg");
        await fs.mkdir(pkgPath, { recursive: true });
        await fs.writeFile(
            path.join(pkgPath, "package.json"),
            JSON.stringify({ name: "test.package", version: "1.0.0" }),
        );
        await fs.writeFile(
            path.join(pkgPath, ".index.json"),
            JSON.stringify({
                "index-version": 1,
                files: [
                    { filename: "Good.json", resourceType: "StructureDefinition", id: "g", url: "http://ex/Good" },
                    { filename: "Bad.json", resourceType: "StructureDefinition", id: "b", url: "http://ex/Bad" },
                ],
            }),
        );
        await fs.writeFile(
            path.join(pkgPath, "Good.json"),
            JSON.stringify({ resourceType: "StructureDefinition", id: "g", url: "http://ex/Good" }),
        );
        await fs.writeFile(
            path.join(pkgPath, "Bad.json"),
            JSON.stringify({ resourceType: "StructureDefinition", id: "b", url: "http://ex/Bad" }),
        );

        const manager = CanonicalManager({
            packages: [],
            workingDir: path.join(root, "wd"),
            patches: { indexEntry: [excludeCanonical({ url: "http://ex/Bad", reason: "cross-version type" })] },
        });
        await manager.addLocalPackage({ name: "test.package", version: "1.0.0", path: pkgPath });
        await manager.init();

        // Consistent across the metadata and resource query surfaces.
        expect(await manager.searchEntries({ url: "http://ex/Bad" })).toHaveLength(0);
        expect(await manager.searchEntries({ url: "http://ex/Good" })).toHaveLength(1);
        await expect(manager.resolve("http://ex/Bad")).rejects.toThrow();
        expect((await manager.resolve("http://ex/Good")).url).toBe("http://ex/Good");

        // The exclusion (with its reason) shows up in the diagnostics report.
        const report = manager.report();
        expect(report.some((e) => e.kind === "exclusion" && e.url === "http://ex/Bad")).toBe(true);
    });
});
