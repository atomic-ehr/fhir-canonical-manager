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

    /** A local package shipping one canonical to keep and one to exclude. */
    const writeTestPackage = async (): Promise<string> => {
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
        return pkgPath;
    };

    test("an excluded canonical is absent from the index and reported", async () => {
        const pkgPath = await writeTestPackage();

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

    /**
     * The cache record is keyed by the package set alone, so managers with different patches
     * share one. Patches used to be applied while scanning and were therefore baked into that
     * shared record: whichever manager scanned first decided what every later one could see.
     */
    test("managers over the same packages do not inherit each other's exclusions", async () => {
        const pkgPath = await writeTestPackage();
        const workingDir = path.join(root, "wd");

        const mkManager = (exclude: boolean) =>
            CanonicalManager({
                packages: [],
                workingDir,
                patches: exclude
                    ? { indexEntry: [excludeCanonical({ url: "http://ex/Bad", reason: "cross-version type" })] }
                    : {},
            });

        const init = async (exclude: boolean) => {
            const manager = mkManager(exclude);
            await manager.addLocalPackage({ name: "test.package", version: "1.0.0", path: pkgPath });
            await manager.init();
            return manager;
        };

        // Patched first, then unpatched: the second must still see the canonical.
        const patched = await init(true);
        expect(await patched.searchEntries({ url: "http://ex/Bad" })).toHaveLength(0);

        const unpatched = await init(false);
        expect(await unpatched.searchEntries({ url: "http://ex/Bad" })).toHaveLength(1);
        expect((await unpatched.resolve("http://ex/Bad")).url).toBe("http://ex/Bad");

        // And the other direction, now that the record is warm: a fresh patched manager must
        // still apply its exclusion rather than trust the index it loads.
        const patchedAgain = await init(true);
        expect(await patchedAgain.searchEntries({ url: "http://ex/Bad" })).toHaveLength(0);
        expect(patchedAgain.report().some((e) => e.kind === "exclusion" && e.url === "http://ex/Bad")).toBe(true);
    });

    /**
     * Adding a package rebuilds the manager (destroy + init) and the entry phase runs on every
     * init, so the report has to be tied to the index it describes rather than accumulating.
     */
    test("rebuilding does not accumulate duplicate report entries", async () => {
        const pkgPath = await writeTestPackage();
        const otherPath = path.join(root, "other");
        await fs.mkdir(otherPath, { recursive: true });
        await fs.writeFile(
            path.join(otherPath, "package.json"),
            JSON.stringify({ name: "other.package", version: "1.0.0" }),
        );
        await fs.writeFile(
            path.join(otherPath, ".index.json"),
            JSON.stringify({
                "index-version": 1,
                files: [{ filename: "O.json", resourceType: "StructureDefinition", id: "o", url: "http://ex/Other" }],
            }),
        );
        await fs.writeFile(
            path.join(otherPath, "O.json"),
            JSON.stringify({ resourceType: "StructureDefinition", id: "o", url: "http://ex/Other" }),
        );

        const manager = CanonicalManager({
            packages: [],
            workingDir: path.join(root, "wd"),
            patches: { indexEntry: [excludeCanonical({ url: "http://ex/Bad", reason: "cross-version type" })] },
        });
        await manager.addLocalPackage({ name: "test.package", version: "1.0.0", path: pkgPath });
        await manager.addLocalPackage({ name: "other.package", version: "1.0.0", path: otherPath });
        await manager.init();

        const exclusions = manager.report().filter((e) => e.kind === "exclusion" && e.url === "http://ex/Bad");
        expect(exclusions).toHaveLength(1);
        // Still excluded after the rebuilds, not merely reported once.
        expect(await manager.searchEntries({ url: "http://ex/Bad" })).toHaveLength(0);
    });

    test("the persisted index keeps a canonical that a manager excludes", async () => {
        const pkgPath = await writeTestPackage();
        const workingDir = path.join(root, "wd");

        const manager = CanonicalManager({
            packages: [],
            workingDir,
            patches: { indexEntry: [excludeCanonical({ url: "http://ex/Bad", reason: "cross-version type" })] },
        });
        await manager.addLocalPackage({ name: "test.package", version: "1.0.0", path: pkgPath });
        await manager.init();

        const records = await fs.readdir(workingDir);
        const cacheKey = records.find((name) => /^[a-f0-9]{64}$/i.test(name));
        expect(cacheKey).toBeDefined();
        const onDisk = JSON.parse(
            await fs.readFile(path.join(workingDir, cacheKey as string, "index.v2.json"), "utf-8"),
        );

        // What the package ships, not what this manager resolves.
        expect(onDisk.entries["http://ex/Bad"]).toHaveLength(1);
        expect(onDisk.entries["http://ex/Good"]).toHaveLength(1);
    });
});
