import { describe, expect, test } from "bun:test";
import { packTar } from "modern-tar";
import { extractPackage } from "../../../src/browser/worker/archive.js";
import { archiveFiles, packageArchive } from "../../browser/fixture.js";

function stream(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array> {
    return new Blob([bytes]).stream();
}

describe("FHIR archive decoding", () => {
    test("uses the library decoder for valid gzip archives and ignores non-package files", async () => {
        const bytes = await archiveFiles({
            "package/package.json": '{"name":"a","version":"1.0.0"}',
            "package/resource.json": "{}",
            "readme.txt": "ignored",
        });
        const content = await extractPackage(stream(bytes));
        expect(content.packageJson).toEqual({ name: "a", version: "1.0.0" });
        expect(Object.keys(content.files)).toEqual(["package.json", "resource.json"]);
    });

    test("drains large ignored entries without blocking a fragmented archive stream", async () => {
        const bytes = await archiveFiles({
            "openapi/large.schema.json": "x".repeat(2 * 1024 * 1024),
            "package/package.json": '{"name":"a","version":"1.0.0"}',
            "package/resource.json": "{}",
        });
        let offset = 0;
        const fragmented = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (offset === bytes.length) return controller.close();
                const end = Math.min(offset + 53, bytes.length);
                controller.enqueue(bytes.slice(offset, end));
                offset = end;
            },
        });
        const content = await extractPackage(fragmented);
        expect(Object.keys(content.files)).toEqual(["package.json", "resource.json"]);
    });

    test("rejects traversal, absolute paths, duplicate files and missing manifests", async () => {
        for (const name of ["package/../secret.json", "/package/secret.json", "C:/package/secret.json"]) {
            const bytes = await archiveFiles({ [name]: "{}" });
            await expect(extractPackage(stream(bytes))).rejects.toThrow("Unsafe package archive path");
        }
        const body = '{"name":"a","version":"1.0.0"}';
        const tar = await packTar(
            [1, 2].map(() => ({ header: { name: "package/package.json", size: body.length }, body })),
        );
        const duplicate = new Uint8Array(
            await new Response(new Blob([tar]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
        );
        await expect(extractPackage(stream(duplicate))).rejects.toThrow("Duplicate package archive path");
        await expect(extractPackage(stream(await archiveFiles({ "package/other.json": "{}" })))).rejects.toThrow(
            "missing package/package.json",
        );
    });

    test("bounds total decompressed bytes, entry count and invalid limits", async () => {
        const bytes = await packageArchive({ name: "a", version: "1.0.0" });
        await expect(extractPackage(stream(bytes), { maxBytes: 100 })).rejects.toThrow("decompressed bytes");
        await expect(extractPackage(stream(bytes), { maxFiles: 1 })).rejects.toThrow("entries");
        await expect(extractPackage(stream(bytes), { maxBytes: -1 })).rejects.toThrow("positive integers");
        await expect(extractPackage(stream(bytes.slice(0, 15)))).rejects.toThrow();
    });
});
