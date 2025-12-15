import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CanonicalManager } from "../../../src";

const LOCAL_CANONICAL = "http://example.org/fhir/StructureDefinition/LocalTestProfile";

describe("CanonicalManager local package integration", () => {
    const tmpRoot = path.join(process.cwd(), "tmp", "local-package-tests");
    const workingDir = path.join(tmpRoot, "working-dir");
    const multiWorkingDir = path.join(tmpRoot, "working-dir-multi");
    const localPackagePath = path.join(tmpRoot, "local-package");
    const localPackageTwoPath = path.join(tmpRoot, "local-package-two");
    const resourceFilePath = path.join(localPackagePath, "StructureDefinition-LocalTestProfile.json");
    const resourceFilePathTwo = path.join(localPackageTwoPath, "StructureDefinition-LocalTestProfileTwo.json");

    const writeLocalResource = async (overrides: Record<string, unknown> = {}) => {
        const resource = {
            resourceType: "StructureDefinition",
            id: "LocalTestProfile",
            url: LOCAL_CANONICAL,
            ...overrides,
        };
        await fs.writeFile(resourceFilePath, JSON.stringify(resource, null, 2));
    };
    const writeLocalResourceTwo = async (overrides: Record<string, unknown> = {}) => {
        const resource = {
            resourceType: "StructureDefinition",
            id: "LocalTestProfileTwo",
            url: `${LOCAL_CANONICAL}-two`,
            ...overrides,
        };
        await fs.writeFile(resourceFilePathTwo, JSON.stringify(resource, null, 2));
    };

    beforeAll(async () => {
        await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
        await fs.mkdir(localPackagePath, { recursive: true });
        await fs.mkdir(localPackageTwoPath, { recursive: true });

        const packageJson = {
            name: "local.test.package",
            version: "1.0.0",
        };
        const packageJsonTwo = {
            name: "local.test.package.two",
            version: "2.0.0",
        };

        const indexContent = {
            "index-version": 1,
            files: [
                {
                    filename: "StructureDefinition-LocalTestProfile.json",
                    resourceType: "StructureDefinition",
                    id: "LocalTestProfile",
                    url: LOCAL_CANONICAL,
                    kind: "resource",
                    type: "StructureDefinition",
                },
            ],
        };
        const indexContentTwo = {
            "index-version": 1,
            files: [
                {
                    filename: "StructureDefinition-LocalTestProfileTwo.json",
                    resourceType: "StructureDefinition",
                    id: "LocalTestProfileTwo",
                    url: `${LOCAL_CANONICAL}-two`,
                    kind: "resource",
                    type: "StructureDefinition",
                },
            ],
        };

        await fs.writeFile(path.join(localPackagePath, "package.json"), JSON.stringify(packageJson, null, 2));
        await fs.writeFile(path.join(localPackagePath, ".index.json"), JSON.stringify(indexContent, null, 2));
        await writeLocalResource();
        await fs.writeFile(path.join(localPackageTwoPath, "package.json"), JSON.stringify(packageJsonTwo, null, 2));
        await fs.writeFile(path.join(localPackageTwoPath, ".index.json"), JSON.stringify(indexContentTwo, null, 2));
        await writeLocalResourceTwo();
    });

    beforeEach(async () => {
        await writeLocalResource();
        await writeLocalResourceTwo();
    });

    afterAll(async () => {
        await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    });

    test("installs, caches, and reloads local packages", async () => {
        const manager = CanonicalManager({
            packages: [],
            workingDir,
        });

        await manager.addLocalPackage({
            name: "local.test.package",
            version: "1.0.0",
            path: localPackagePath,
        });

        const entry = await manager.resolveEntry(LOCAL_CANONICAL);
        expect(entry.package?.name).toBe("local.test.package");
        expect(entry.package?.version).toBe("1.0.0");

        await manager.destroy();
        await manager.init();

        const packages = await manager.packages();
        const hasLocalPackage = packages.some((pkg) => pkg.name === "local.test.package" && pkg.version === "1.0.0");
        expect(hasLocalPackage).toBe(true);

        const resource = await manager.resolve(LOCAL_CANONICAL);
        expect(resource.resourceType).toBe("StructureDefinition");
        expect(resource.url).toBe(LOCAL_CANONICAL);

        await manager.destroy();
    });

    test("detects and rebuilds when local resources change", async () => {
        const changeWorkingDir = path.join(tmpRoot, "working-dir-change");
        await fs.rm(changeWorkingDir, { recursive: true, force: true }).catch(() => {});

        const manager = CanonicalManager({
            packages: [],
            workingDir: changeWorkingDir,
        });

        const config = {
            name: "local.test.package",
            version: "1.0.0",
            path: localPackagePath,
        };

        await manager.addLocalPackage(config);
        let resource = await manager.resolve(LOCAL_CANONICAL);
        expect(resource.description).toBeUndefined();
        await manager.destroy();

        await writeLocalResource({ description: "Updated" });

        await manager.addLocalPackage(config);
        resource = await manager.resolve(LOCAL_CANONICAL);
        expect(resource.description).toBe("Updated");

        await manager.destroy();
    });

    test("rebuilds during init when local resources change", async () => {
        const manager = CanonicalManager({
            packages: [],
            workingDir,
        });

        const config = {
            name: "local.test.package",
            version: "1.0.0",
            path: localPackagePath,
        };

        await manager.addLocalPackage(config);
        let resource = await manager.resolve(LOCAL_CANONICAL);
        expect(resource.description).toBeUndefined();

        await manager.destroy();
        await writeLocalResource({ description: "Changed without re-adding" });

        await manager.init();
        resource = await manager.resolve(LOCAL_CANONICAL);
        expect(resource.description).toBe("Changed without re-adding");

        await manager.destroy();
    });

    test("rebuilds during init when multiple local packages change", async () => {
        await fs.rm(multiWorkingDir, { recursive: true, force: true }).catch(() => {});
        const manager = CanonicalManager({
            packages: [],
            workingDir: multiWorkingDir,
        });

        await manager.addLocalPackage({
            name: "local.test.package",
            version: "1.0.0",
            path: localPackagePath,
        });
        await manager.addLocalPackage({
            name: "local.test.package.two",
            version: "2.0.0",
            path: localPackageTwoPath,
        });

        let resourceOne = await manager.resolve(LOCAL_CANONICAL);
        let resourceTwo = await manager.resolve(`${LOCAL_CANONICAL}-two`);
        expect(resourceOne.description).toBeUndefined();
        expect(resourceTwo.notes).toBeUndefined();

        await manager.destroy();
        await writeLocalResource({ description: "Multi changed 1" });
        await writeLocalResourceTwo({ notes: "Multi changed 2" });

        await manager.init();
        resourceOne = await manager.resolve(LOCAL_CANONICAL);
        resourceTwo = await manager.resolve(`${LOCAL_CANONICAL}-two`);
        expect(resourceOne.description).toBe("Multi changed 1");
        expect(resourceTwo.notes).toBe("Multi changed 2");

        await manager.destroy();
    });
});
