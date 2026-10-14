import { describe, expect, test } from "bun:test";
import { collectFromIndex, collectFromSource, type ResourceSource } from "../../../src/core/resource-index.js";

function fixture(files: Record<string, string>): ResourceSource {
    return {
        async read(filename) {
            const content = files[filename];
            if (content === undefined) throw new Error("unavailable");
            return content;
        },
        async has(filename) {
            return filename in files;
        },
        async listFiles() {
            return Object.keys(files);
        },
    };
}

const url = "http://example.org/StructureDefinition/Patient";
const index = JSON.stringify({
    "index-version": 0,
    files: [
        { filename: "Patient.json", id: "Patient", resourceType: "StructureDefinition", url, version: "clinical-1" },
        { filename: "missing.json", id: "Missing", resourceType: "StructureDefinition", url: `${url}-missing` },
        { filename: "example.json", id: "Example", resourceType: "Patient" },
    ],
});

describe("shared resource collection", () => {
    test("keeps partial shipped indexes and reads metadata without parsing resource bodies", async () => {
        const source = fixture({
            ".index.json": index,
            "Patient.json": "body intentionally unavailable to JSON parsing",
        });
        const reads: string[] = [];
        const read = source.read;
        source.read = async (filename) => {
            reads.push(filename);
            return read(filename);
        };
        const { result, entries } = await collectFromIndex(source);
        expect(result).toEqual({ ok: false, reason: "missing-files" });
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ filename: "Patient.json", url, indexVersion: 0, version: "clinical-1" });
        expect(reads).toEqual([".index.json"]);
    });

    test("distinguishes unreadable or corrupt indexes from valid empty indexes", async () => {
        const cases: Record<string, string>[] = [{}, { ".index.json": "invalid JSON" }, { ".index.json": "{}" }];
        for (const files of cases) {
            expect((await collectFromIndex(fixture(files))).result).toEqual({ ok: false, reason: "unparseable" });
        }
        expect((await collectFromIndex(fixture({ ".index.json": '{"index-version":1,"files":[]}' }))).result).toEqual({
            ok: true,
            count: 0,
        });
    });

    test("fallback tolerates bad files and excludes manifests and resources without canonicals", async () => {
        const source = fixture({
            "package.json": JSON.stringify({ resourceType: "StructureDefinition", url: "manifest" }),
            ".index.json": "unparseable",
            "bad.json": "unparseable",
            "example.json": JSON.stringify({ resourceType: "Patient", id: "example" }),
            "Patient.json": JSON.stringify({
                resourceType: "StructureDefinition",
                url,
                kind: "resource",
                type: "Patient",
            }),
            "notes.txt": "text",
        });
        expect(await collectFromSource(source)).toEqual([
            {
                filename: "Patient.json",
                resourceType: "StructureDefinition",
                url,
                version: undefined,
                kind: "resource",
                type: "Patient",
                indexVersion: 0,
            },
        ]);
        source.listFiles = async () => {
            throw new Error("source unavailable");
        };
        expect(await collectFromSource(source)).toEqual([]);
    });
});
