import type { Cache } from "../cache.js";
import type { Fetch } from "../fetch.js";
import { cachePrefix, normalizeRegistry, parsePackageSpec, validateDependencies } from "../package-spec.js";
import type { ArchiveLimits, MetadataRequest, MetadataResponse, Progress, SelectedManifest } from "../protocol.js";
import { extractPackage, type PackageContent } from "./archive.js";
import { downloadReporter } from "./progress.js";

export function createRegistry(config: {
    registry?: string;
    fetch?: Fetch;
    cache: Cache;
    archiveLimits?: ArchiveLimits;
    requestTimeoutMs?: number;
    onProgress?: (progress: Progress) => void;
}) {
    const registry = normalizeRegistry(config.registry);
    const endpoint = new URL(registry);
    const prefix = cachePrefix(registry);
    const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
    const requestTimeoutMs = config.requestTimeoutMs ?? 60_000;
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1)
        throw new Error("requestTimeoutMs must be a positive integer");

    function admit(url: string): URL {
        const target = new URL(url);
        if (target.origin !== endpoint.origin || target.username || target.password || target.hash)
            throw new Error(`Blocked FHIR request outside configured registry origin: ${url}`);
        return target;
    }

    return {
        registry,
        clear: () => config.cache.clear(prefix),
        session(signal?: AbortSignal) {
            const staged = new Map<string, unknown>();
            const metadata = new Map<string, Promise<MetadataResponse>>();
            const archives = new Map<string, Promise<PackageContent>>();
            let closed = false;
            const check = () => {
                signal?.throwIfAborted();
                if (closed) throw new Error("Registry session is closed");
            };
            async function get<T>(key: string): Promise<T | undefined> {
                check();
                return (staged.has(key) ? structuredClone(staged.get(key)) : await config.cache.get<T>(key)) as
                    | T
                    | undefined;
            }
            async function request(url: string, init: RequestInit, operationSignal: AbortSignal): Promise<Response> {
                admit(url);
                check();
                const active = AbortSignal.any([
                    operationSignal,
                    ...(signal ? [signal] : []),
                    AbortSignal.timeout(requestTimeoutMs),
                ]);
                active.throwIfAborted();
                const response = await fetchImpl(url, {
                    ...init,
                    signal: active,
                    credentials: "omit",
                    redirect: "error",
                });
                active.throwIfAborted();
                if (response.redirected || (response.url && new URL(response.url).origin !== endpoint.origin))
                    throw new Error(`Unexpected FHIR registry redirect: ${url}`);
                return response;
            }
            return {
                registry,
                async metadata(options: MetadataRequest, operationSignal: AbortSignal): Promise<MetadataResponse> {
                    const url = admit(options.url);
                    if (!url.pathname.startsWith(endpoint.pathname) || options.method !== "GET")
                        throw new Error("Only configured FHIR packument GET requests are supported");
                    const key = `${prefix}metadata:${url.href}`;
                    let pending = metadata.get(key);
                    if (!pending) {
                        pending = (async () => {
                            const cached = await get<MetadataResponse>(key);
                            if (cached) return cached;
                            const response = await request(
                                url.href,
                                { method: options.method, headers: options.headers },
                                operationSignal,
                            );
                            const bytes = await readBounded(response, 20 * 1024 * 1024, operationSignal);
                            const result = {
                                bytes,
                                headers: [...response.headers.entries()] as [string, string][],
                                url: url.href,
                                status: response.status,
                                statusText: response.statusText,
                            };
                            if (response.ok) {
                                const data = JSON.parse(new TextDecoder().decode(bytes));
                                if (!data?.versions || typeof data.versions !== "object")
                                    throw new Error("Invalid FHIR registry packument");
                                check();
                                staged.set(key, result);
                            }
                            return result;
                        })();
                        metadata.set(key, pending);
                    }
                    return structuredClone(await pending);
                },
                async hydrate(selected: SelectedManifest, operationSignal: AbortSignal): Promise<PackageContent> {
                    const pkg = parsePackageSpec(`${selected.name}@${selected.version}`);
                    const tarball = admit(selected.dist?.tarball).href;
                    const integrity = advertisedIntegrity(selected);
                    const key = `${prefix}archive:${JSON.stringify([pkg.name, pkg.version, tarball, integrity])}`;
                    let pending = archives.get(key);
                    if (!pending) {
                        pending = (async () => {
                            let bytes = await get<Uint8Array>(key);
                            if (!bytes) {
                                const response = await request(tarball, { method: "GET" }, operationSignal);
                                if (!response.ok)
                                    throw new Error(`FHIR archive request failed: ${tarball} (${response.status})`);
                                bytes = await readBounded(
                                    response,
                                    config.archiveLimits?.maxBytes ?? 200 * 1024 * 1024,
                                    operationSignal,
                                    config.onProgress ? downloadReporter(response, pkg, config.onProgress) : undefined,
                                );
                            }
                            config.onProgress?.({ phase: "verify", package: pkg, done: false });
                            await verifyIntegrity(bytes, integrity);
                            config.onProgress?.({ phase: "verify", package: pkg, done: true });
                            check();
                            operationSignal.throwIfAborted();
                            config.onProgress?.({ phase: "extract", package: pkg, entries: 0, done: false });
                            let entries = 0;
                            const content = await extractPackage(
                                new Blob([bytes as Uint8Array<ArrayBuffer>]).stream(),
                                config.archiveLimits,
                                operationSignal,
                                config.onProgress
                                    ? (count) => {
                                          entries = count;
                                          config.onProgress?.({ phase: "extract", package: pkg, entries, done: false });
                                      }
                                    : undefined,
                            );
                            config.onProgress?.({ phase: "extract", package: pkg, entries, done: true });
                            if (content.packageJson.name !== pkg.name || content.packageJson.version !== pkg.version)
                                throw new Error(
                                    `FHIR package manifest identity ${content.packageJson.name}@${content.packageJson.version} does not match ${pkg.name}@${pkg.version}`,
                                );
                            validateDependencies(content.packageJson);
                            check();
                            operationSignal.throwIfAborted();
                            staged.set(key, bytes);
                            return content;
                        })();
                        archives.set(key, pending);
                    }
                    try {
                        return await pending;
                    } catch (error) {
                        throw new Error(
                            `${pkg.name}@${pkg.version}: ${error instanceof Error ? error.message : String(error)}`,
                            { cause: error },
                        );
                    }
                },
                async commit() {
                    check();
                    if (config.cache.putMany) await config.cache.putMany([...staged], signal);
                    else
                        for (const [key, value] of staged) {
                            check();
                            await config.cache.put(key, value);
                        }
                    check();
                    closed = true;
                },
                discard() {
                    closed = true;
                    staged.clear();
                    metadata.clear();
                    archives.clear();
                },
            };
        },
    };
}

function advertisedIntegrity(selected: SelectedManifest): string {
    if (typeof selected.dist?.integrity === "string" && selected.dist.integrity) return selected.dist.integrity;
    const sha1 = selected.dist?.shasum;
    if (!sha1 || !/^[a-f\d]{40}$/i.test(sha1))
        throw new Error(`Missing or invalid advertised checksum for ${selected.name}@${selected.version}`);
    return `sha1-${btoa(String.fromCharCode(...Uint8Array.from(sha1.match(/../g) ?? [], (part) => parseInt(part, 16))))}`;
}

export async function verifyIntegrity(bytes: Uint8Array, integrity: string): Promise<void> {
    const algorithms = ["sha512", "sha384", "sha256", "sha1"];
    const entries = integrity
        .trim()
        .split(/\s+/)
        .map((entry) => entry.split("-"));
    const algorithm = algorithms.find((candidate) => entries.some(([name]) => name === candidate));
    if (!algorithm) throw new Error("Unsupported advertised FHIR archive checksum");
    const digest = new Uint8Array(
        await crypto.subtle.digest(algorithm.toUpperCase().replace("SHA", "SHA-"), bytes as Uint8Array<ArrayBuffer>),
    );
    const actual = btoa(String.fromCharCode(...digest));
    if (!entries.some(([name, value]) => name === algorithm && value === actual))
        throw new Error(`EINTEGRITY: FHIR archive does not match advertised ${algorithm} checksum`);
}

async function readBounded(
    response: Response,
    maxBytes: number,
    signal: AbortSignal,
    progress?: (receivedBytes: number, done: boolean) => void,
): Promise<Uint8Array<ArrayBuffer>> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Archive limits must be positive integers");
    if (!response.body) throw new Error("FHIR registry returned no response body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        progress?.(0, false);
        while (true) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            signal.throwIfAborted();
            if (done) break;
            total += value.length;
            if (total > maxBytes) throw new Error(`FHIR response exceeds ${maxBytes} bytes`);
            chunks.push(value);
            progress?.(total, false);
        }
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    } finally {
        reader.releaseLock();
    }
    signal.throwIfAborted();
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    progress?.(total, true);
    return result;
}
