import { createTarDecoder } from "modern-tar";
import type { PackageJson } from "../../types/index.js";

import type { ArchiveLimits } from "../protocol.js";

export interface PackageContent {
    packageJson: PackageJson;
    files: Record<string, string>;
}

export async function extractPackage(
    body: ReadableStream<Uint8Array>,
    limits: ArchiveLimits = {},
    signal?: AbortSignal,
    progress?: (entries: number) => void,
): Promise<PackageContent> {
    const maxBytes = limits.maxBytes ?? 200 * 1024 * 1024;
    const maxFiles = limits.maxFiles ?? 25_000;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxFiles) || maxFiles < 1) {
        throw new Error("Archive limits must be positive integers");
    }
    let total = 0;
    let count = 0;
    const bounded = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            total += chunk.byteLength;
            if (total > maxBytes) throw new Error(`Package archive exceeds ${maxBytes} decompressed bytes`);
            controller.enqueue(chunk);
        },
    });
    const stream = body
        .pipeThrough(new DecompressionStream("gzip"), { signal })
        .pipeThrough(bounded, { signal })
        .pipeThrough(createTarDecoder({ strict: true }), { signal });
    const files: Record<string, string> = Object.create(null);
    for await (const entry of stream) {
        signal?.throwIfAborted();
        const name = entry.header.name.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
        if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split("/").includes("..")) {
            await entry.body.cancel();
            throw new Error(`Unsafe package archive path: ${entry.header.name}`);
        }
        if (++count > maxFiles) {
            await entry.body.cancel();
            throw new Error(`Package archive exceeds ${maxFiles} entries`);
        }
        if (count % 128 === 0) progress?.(count);
        if (entry.header.type !== "file" || !name.startsWith("package/")) {
            // Drain incrementally: cancelling a large body can block the decoder's bounded input buffer.
            for await (const _chunk of entry.body) {
                // Intentionally discard entries outside package/ and non-regular files.
            }
            continue;
        }
        const filename = name.slice("package/".length);
        if (Object.hasOwn(files, filename)) {
            await entry.body.cancel();
            throw new Error(`Duplicate package archive path: ${name}`);
        }
        files[filename] = await new Response(entry.body).text();
    }
    progress?.(count);
    const manifest = files["package.json"];
    if (!manifest) throw new Error("Package archive is missing package/package.json");
    const packageJson = JSON.parse(manifest) as PackageJson;
    if (!packageJson || typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
        throw new Error("Invalid FHIR package manifest");
    }
    return { packageJson, files };
}
