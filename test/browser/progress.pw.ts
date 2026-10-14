import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import type { Progress } from "../../src/browser/index.js";
import type { api } from "./client.js";
import { patientUrl, registryFixture } from "./fixture.js";

declare global {
    var fcm: typeof api;
}

let app: Server;
let registry: Server;
let origin: string;
let registryUrl: string;
const archiveBytes: Record<string, number> = {};

async function listen(server: Server) {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    return `http://127.0.0.1:${address.port}/`;
}

test.beforeAll(async () => {
    const packages = ["known", "unknown", "encoded", "filtered"].map((name) => ({ name, version: "1.0.0" }));
    const fixture = await registryFixture(packages);
    registry = createServer(async (request, response) => {
        const url = new URL(request.url ?? "/", registryUrl);
        if (request.method === "OPTIONS") {
            response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
            response.end();
            return;
        }
        const result = fixture.handle(url);
        const data = new Uint8Array(await result.arrayBuffer());
        response.setHeader("access-control-allow-origin", "*");
        response.setHeader("content-type", result.headers.get("content-type") ?? "application/gzip");
        if (!url.pathname.endsWith("/1.0.0")) {
            response.end(data);
            return;
        }
        const name = url.pathname.split("/").at(-2) ?? "";
        archiveBytes[name] = data.length;
        const encoded = name === "encoded" || name === "filtered";
        const body = encoded ? gzipSync(data) : data;
        if (name !== "unknown") response.setHeader("content-length", body.length);
        if (name === "known" || encoded) response.setHeader("content-encoding", encoded ? "gzip" : "identity");
        if (name !== "filtered") response.setHeader("access-control-expose-headers", "content-encoding");
        response.flushHeaders();
        const size = Math.ceil(body.length / 8);
        for (let offset = 0; offset < body.length; offset += size) {
            if (response.destroyed) return;
            response.write(body.subarray(offset, offset + size));
            await new Promise<void>((resolve) => setTimeout(resolve, 40));
        }
        response.end();
    });
    registryUrl = await listen(registry);
    const client = await readFile("tmp/browser-client.js");
    app = createServer((request, response) => {
        if (request.url === "/client.js") {
            response.setHeader("content-type", "text/javascript");
            response.end(client);
        } else {
            response.setHeader("content-type", "text/html");
            response.setHeader(
                "content-security-policy",
                "default-src 'none'; script-src 'self'; worker-src blob:; connect-src http://127.0.0.1:*;",
            );
            response.end('<!doctype html><script type="module" src="/client.js"></script>');
        }
    });
    origin = await listen(app);
});
test.afterAll(async () => {
    await Promise.all([app, registry].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});
test.beforeEach(async ({ page }) => {
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(globalThis.fcm));
});

for (const custom of [false, true]) {
    test(`packed progress counts Fetch body bytes and handles CORS/HTTP encoding (${custom ? "custom" : "native"} fetch)`, async ({
        page,
    }) => {
        const result = await page.evaluate(
            async ({ registryUrl, custom }) => {
                const updates: Progress[] = [];
                let notifications = 0;
                const NativeWorker = globalThis.Worker;
                globalThis.Worker = class extends NativeWorker {
                    constructor(url: string | URL, options?: WorkerOptions) {
                        super(url, options);
                        this.addEventListener("message", ({ data }) => {
                            if (data.type === "progress") notifications++;
                        });
                    }
                };
                const manager = fcm.createCanonicalManager({
                    packages: ["known@1.0.0", "unknown@1.0.0", "encoded@1.0.0", "filtered@1.0.0"],
                    registry: registryUrl,
                    ...(custom ? { fetch: (input, init) => fetch(input, init) } : {}),
                    onProgress(progress) {
                        updates.push(progress);
                    },
                });
                const started = performance.now();
                try {
                    await manager.init();
                    const elapsed = performance.now() - started;
                    const count = updates.length;
                    const firstNotifications = notifications;
                    await manager.init();
                    return {
                        updates: updates.slice(0, count),
                        cachedUpdates: updates.slice(count),
                        elapsed,
                        notifications: firstNotifications,
                        cachedEvents: updates.slice(count).filter((event) => event.phase === "download").length,
                        packageCount: (await manager.packages()).length,
                    };
                } finally {
                    await manager.destroy();
                    globalThis.Worker = NativeWorker;
                }
            },
            { registryUrl, custom },
        );
        expect(result.cachedEvents).toBe(0);
        expect(result.packageCount).toBe(4);
        expect(result.notifications).toBeLessThanOrEqual(Math.ceil(result.elapsed / 100) + 1);
        expect(result.updates[0]).toEqual({ phase: "resolve", done: false });
        expect(result.updates.at(-1)).toEqual({ phase: "ready", packages: 4, resources: 4 });
        expect(result.cachedUpdates.at(-1)).toEqual({ phase: "ready", packages: 4, resources: 4 });
        expect(result.updates.slice(-3, -1)).toEqual([
            { phase: "cache", action: "commit", done: false },
            { phase: "cache", action: "commit", done: true },
        ]);
        const resolved = result.updates.findIndex((event) => event.phase === "resolve" && event.done);
        const indexed = result.updates.findIndex((event) => event.phase === "index" && event.done);
        expect(resolved).toBeGreaterThan(0);
        expect(indexed).toBeGreaterThan(resolved);
        expect(result.updates[indexed]).toEqual({ phase: "index", resources: 4, done: true });
        for (const name of ["known", "unknown", "encoded", "filtered"]) {
            const phases = result.updates.filter((event) => "package" in event && event.package.name === name);
            const downloaded = phases.findIndex((event) => event.phase === "download" && event.done);
            const verified = phases.findIndex((event) => event.phase === "verify" && event.done);
            const extracted = phases.findIndex((event) => event.phase === "extract" && event.done);
            expect(verified).toBeGreaterThan(downloaded);
            expect(extracted).toBeGreaterThan(verified);
            const updates = result.updates.filter(
                (progress) => progress.phase === "download" && progress.package.name === name,
            ) as Extract<Progress, { phase: "download" }>[];
            expect(updates.length).toBeGreaterThan(0);
            expect(updates.at(-1)).toEqual({
                phase: "download",
                package: { name, version: "1.0.0" },
                receivedBytes: archiveBytes[name],
                ...(name === "known" ? { totalBytes: archiveBytes[name] } : {}),
                done: true,
            });
            expect(updates.map((progress) => progress.receivedBytes)).toEqual(
                updates.map((progress) => progress.receivedBytes).sort((a, b) => a - b),
            );
            if (name === "unknown")
                expect(updates.some((progress) => !progress.done && progress.receivedBytes > 0)).toBe(true);
            if (name !== "known") expect(updates.every((progress) => progress.totalBytes === undefined)).toBe(true);
        }
    });
    for (const cancel of ["destroy", "abort"] as const) {
        test(`progress stops after ${cancel} during ${custom ? "custom" : "native"} streaming fetch`, async ({
            page,
        }) => {
            const result = await page.evaluate(
                async ({ registryUrl, custom, cancel, patientUrl }) => {
                    const controller = new AbortController();
                    const updates: Progress[] = [];
                    let start: () => void = () => {};
                    const receiving = new Promise<void>((resolve) => {
                        start = resolve;
                    });
                    const manager = fcm.createCanonicalManager({
                        packages: ["unknown@1.0.0"],
                        registry: registryUrl,
                        ...(custom ? { fetch: (input, init) => fetch(input, init) } : {}),
                        ...(cancel === "abort" ? { signal: controller.signal } : {}),
                        onProgress(progress) {
                            updates.push(progress);
                            if (progress.phase === "download" && !progress.done && progress.receivedBytes > 0) start();
                        },
                    });
                    try {
                        const initializing = manager.init().then(
                            () => "unexpected success",
                            (error) => String(error),
                        );
                        await receiving;
                        if (cancel === "abort") controller.abort(new Error("download cancelled"));
                        else await manager.destroy();
                        const error = await initializing;
                        const count = updates.length;
                        await new Promise<void>((resolve) => setTimeout(resolve, 250));
                        const quiet = updates.length === count;
                        const noDone = !updates.some(
                            (progress) =>
                                progress.phase === "ready" || (progress.phase === "download" && progress.done),
                        );
                        let fresh: unknown;
                        if (cancel === "destroy") {
                            await manager.init();
                            fresh = (await manager.resolve(patientUrl)).type;
                        }
                        return { error, quiet, noDone, fresh };
                    } finally {
                        await manager.destroy();
                    }
                },
                { registryUrl, custom, cancel, patientUrl },
            );
            expect(result.error).toContain(cancel === "abort" ? "download cancelled" : "destroy");
            expect(result.quiet).toBe(true);
            expect(result.noDone).toBe(true);
            if (cancel === "destroy") expect(result.fresh).toBe("Patient");
        });
    }
}
