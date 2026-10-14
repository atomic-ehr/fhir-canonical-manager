import { validRange } from "semver";
import type { PackageId, PackageJson } from "../types/index.js";

export const DEFAULT_REGISTRY = "https://packages.simplifier.net/";
export function normalizeRegistry(value = DEFAULT_REGISTRY): string {
    const endpoint = new URL(value);
    if (
        !/^https?:$/.test(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
    )
        throw new Error("Use an HTTP(S) FHIR registry endpoint without credentials, query or fragment");
    return endpoint.href.replace(/\/*$/, "/");
}
export const cachePrefix = (registry: string): string => `${JSON.stringify(registry)}|verified-v2|`;
export function parsePackageSpec(spec: string): PackageId {
    const at = spec.lastIndexOf("@");
    const name = at > 0 ? spec.slice(0, at) : spec;
    const version = at > 0 ? spec.slice(at + 1) : "latest";
    if (!/^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+$/.test(name) || name === "." || name === ".." || !version)
        throw new Error(`Invalid FHIR package spec: ${spec}`);
    if (!validRange(version) && !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(version))
        throw new Error(`Unsupported FHIR package version: ${version}`);
    return { name, version };
}
export function validateDependencies(manifest: PackageJson): void {
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
        const dependencies = manifest[field];
        if (dependencies === undefined) continue;
        if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies))
            throw new Error(`Invalid FHIR manifest ${field}`);
        for (const [name, selector] of Object.entries(dependencies)) {
            if (typeof selector !== "string") throw new Error(`Invalid FHIR dependency ${name}`);
            parsePackageSpec(`${name}@${selector}`);
        }
    }
    if (manifest.bundledDependencies || manifest.bundleDependencies)
        throw new Error("Bundled FHIR dependencies are unsupported");
}
