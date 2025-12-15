import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CanonicalManager } from "../../../src";

const LOCAL_CANONICAL = "http://example.org/fhir/StructureDefinition/LocalTestProfile";

describe("CanonicalManager local package integration", () => {
    const tmpRoot = path.join(process.cwd(), "tmp", "local-package-tests");
    const workingDir = path.join(tmpRoot, "working-dir");
    const localPackagePath = path.join(tmpRoot, "local-package");
    const resourceFilePath = path.join(localPackagePath, "StructureDefinition-LocalTestProfile.json");

    const writeLocalResource = async (overrides: Record<string, unknown> = {}) => {
        const resource = {
            resourceType: "StructureDefinition",
            id: "LocalTestProfile",
            url: LOCAL_CANONICAL,
            ...overrides,
        };
        await fs.writeFile(resourceFilePath, JSON.stringify(resource, null, 2));
    };

    beforeAll(async () => {
        await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
        await fs.mkdir(localPackagePath, { recursive: true });

        const packageJson = {
            name: "local.test.package",
            version: "1.0.0",
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

        await fs.writeFile(path.join(localPackagePath, "package.json"), JSON.stringify(packageJson, null, 2));
        await fs.writeFile(path.join(localPackagePath, ".index.json"), JSON.stringify(indexContent, null, 2));
        await writeLocalResource();
    });

    beforeEach(async () => {
        await writeLocalResource();
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
});
