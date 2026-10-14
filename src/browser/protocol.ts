import type { IndexEntry, PackageId, PackageJson, ReportEntry, Resource } from "../types/index.js";

export interface ArchiveLimits {
    maxBytes?: number;
    maxFiles?: number;
}
/** Archive-body bytes delivered by Fetch; done marks EOF, before integrity verification. */
export interface DownloadProgress {
    phase: "download";
    package: PackageId;
    receivedBytes: number;
    totalBytes?: number;
    done: boolean;
}
/** Progress of one initialization/addition; resolution can overlap package phases. */
export type Progress =
    | { phase: "resolve"; done: boolean }
    | { phase: "cache"; action: "clear" | "commit"; done: boolean }
    | { phase: "verify"; package: PackageId; done: boolean }
    | { phase: "extract"; package: PackageId; entries: number; done: boolean }
    | { phase: "index"; resources: number; done: boolean }
    | DownloadProgress
    | { phase: "ready"; packages: number; resources: number };
export interface SelectedManifest extends PackageJson {
    dist: { tarball: string; shasum?: string; integrity?: string };
    _resolved?: string;
    _integrity?: string;
}
export interface MetadataRequest {
    url: string;
    method: string;
    headers: [string, string][];
}
export interface MetadataResponse {
    bytes: Uint8Array;
    headers: [string, string][];
    url: string;
    status: number;
    statusText: string;
}
export interface EngineNode {
    scope: string;
    name: string;
    version: string;
    linkTarget?: string;
    dependencies: { name: string; target: string }[];
}
export interface NodeSnapshot extends Omit<EngineNode, "name" | "version"> {
    pkg: PackageId;
    transport: PackageId;
    packageJson: PackageJson;
}
export interface ReferenceMetadata {
    scope: string;
    filename: string;
    packageName: string;
    packageVersion: string;
    resourceType: string;
    url?: string;
    version?: string;
}
export interface Snapshot {
    nodes: NodeSnapshot[];
    roots: string[];
    installed: Record<string, PackageId>;
    entries: Record<string, IndexEntry[]>;
    references: Record<string, ReferenceMetadata>;
    reports: ReportEntry[];
}
export interface PrepareOptions {
    specs: string[];
    registry: string;
    archiveLimits?: ArchiveLimits;
    requestTimeoutMs?: number;
    graphTimeoutMs?: number;
    mode: "use" | "recover" | "regenerate";
    deprecatedIndexOption: boolean;
    customFetch: boolean;
    manifestPatches: boolean;
    atomicCache: boolean;
    progress?: boolean;
}
export interface WorkerMethods {
    prepare: { input: PrepareOptions; output: Snapshot };
    commit: { input: undefined; output: undefined };
    read: { input: { scope: string; filename: string; id: string }; output: Resource };
}
export interface HostMethods {
    cacheGet: { input: { key: string }; output: unknown };
    cachePut: { input: { key: string; value: unknown }; output: undefined };
    cachePutMany: { input: { entries: [string, unknown][] }; output: undefined };
    cacheClear: { input: { prefix: string }; output: undefined };
    patchManifest: {
        input: { pkg: PackageId; manifest: PackageJson };
        output: { manifest: PackageJson; reports: ReportEntry[] };
    };
    fetchOpen: {
        input: MetadataRequest;
        output: {
            id: number;
            status: number;
            statusText: string;
            headers: [string, string][];
            url: string;
            redirected: boolean;
            type: Response["type"];
            hasBody: boolean;
        };
    };
    fetchRead: { input: { id: number }; output: Uint8Array | null };
    fetchCancel: { input: { id: number }; output: undefined };
}

export interface SerializedError {
    name: string;
    message: string;
    stack?: string;
    code?: string;
}
export function serializeError(error: unknown): SerializedError {
    if (!(error instanceof Error)) return { name: "Error", message: String(error) };
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return { name: error.name, message: error.message, stack: error.stack, code };
}
export function deserializeError(error: SerializedError): Error {
    return Object.assign(new Error(error.message), error);
}
