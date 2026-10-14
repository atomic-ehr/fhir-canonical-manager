import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CanonicalManager } from "../../../src/index.js";

test("the Node adapter preserves exact resolution, search filters and lifecycle guards", async () => {
    const root = path.join("tmp", `query-adapter-${crypto.randomUUID()}`);
    const source = path.join(root, "source");
    const url = "http://example.org/StructureDefinition/Patient";
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, "package.json"), JSON.stringify({ name: "example.ig", version: "2.0.0" }));
    await fs.writeFile(
        path.join(source, "Patient.json"),
        JSON.stringify({ id: "Patient", resourceType: "StructureDefinition", url, version: "clinical-1" }),
    );
    const manager = CanonicalManager({
        packages: [],
        workingDir: path.join(root, "cache"),
        patches: { fhirResource: [(_pkg, resource) => ({ ...resource, patched: true })] },
    });
    try {
        await expect(manager.resolve(url)).rejects.toThrow("not initialized");
        await manager.addLocalPackage({ name: "example.ig", version: "2.0.0", path: source });
        expect((await manager.resolve(url, { version: "clinical-1" })).patched).toBe(true);
        await expect(manager.resolveEntry(url, { version: "2.0.0" })).rejects.toThrow("with given options");
        expect(await manager.searchEntries({ package: { name: "example.ig", version: "2.0.0" } })).toHaveLength(1);
        expect(await manager.searchEntries({ url: "" })).toHaveLength(1);
        await expect(manager.resolveEntry("")).rejects.toThrow("Cannot resolve canonical URL: ");
        await manager.destroy();
        await expect(manager.searchEntries({})).rejects.toThrow("not initialized");
        await manager.init();
        expect((await manager.resolve(url)).patched).toBe(true);
    } finally {
        await manager.destroy();
        await fs.rm(root, { recursive: true, force: true });
    }
});
