import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { installLocalFolder } from "../../../src/local";

const RESOURCE_CONTENT = {
    resourceType: "StructureDefinition",
    id: "LocalTestResource",
    url: "http://example.org/StructureDefinition/LocalTestResource",
};

const createLocalPackageSource = async (dir: string) => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify(
            {
                name: "local.test.package",
                version: "1.0.0",
            },
            null,
            2,
        ),
    );
    await fs.writeFile(
        path.join(dir, ".index.json"),
        JSON.stringify(
            {
                "index-version": 1,
                files: [
                    {
                        filename: "StructureDefinition-LocalTestResource.json",
                        resourceType: "StructureDefinition",
                        id: "LocalTestResource",
                        url: RESOURCE_CONTENT.url,
                    },
                ],
            },
            null,
            2,
        ),
    );
    await fs.writeFile(
        path.join(dir, "StructureDefinition-LocalTestResource.json"),
        JSON.stringify(RESOURCE_CONTENT, null, 2),
    );
};

describe("installLocalFolder", () => {
    const tmpRoot = path.join(process.cwd(), "tmp", "local-install-tests");
    const sourceDir = path.join(tmpRoot, "source");
    const destDir = path.join(tmpRoot, "workspace");

    beforeAll(async () => {
        await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
        await createLocalPackageSource(sourceDir);
    });

    afterAll(async () => {
        await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    });

    test("adds dependencies to generated package.json", async () => {
        const config = {
            name: "local.test.package",
            version: "1.0.0",
            path: sourceDir,
            dependencies: ["dep.pkg.one@1.0.0", "./relative/path", "dep.pkg.two@2.0.0"],
        };

        await installLocalFolder(config, destDir);

        const pkgPath = path.join(destDir, "node_modules", "local.test.package", "package.json");
        const pkgJson = JSON.parse(await fs.readFile(pkgPath, "utf-8"));

        expect(pkgJson.dependencies?.["dep.pkg.one"]).toBe("1.0.0");
        expect(pkgJson.dependencies?.["dep.pkg.two"]).toBe("2.0.0");
        expect(pkgJson.dependencies?.["./relative/path"]).toBeUndefined();
    });
});
