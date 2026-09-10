/**
 * Composable patches: transform/filter packages, index entries, and resources.
 */

import type {
    EntryPatch,
    IndexEntry,
    PackageId,
    PackagePatch,
    PatchReportSink,
    Resource,
    ResourcePatch,
} from "./types/index.js";

/** Match a package by exact name, name+version, or a predicate. */
export type PackageMatch = string | PackageId | ((pkg: PackageId) => boolean);

export const matchPackage = (match: PackageMatch, pkg: PackageId): boolean => {
    if (typeof match === "function") return match(pkg);
    if (typeof match === "string") return pkg.name === match;
    return pkg.name === match.name && (match.version === undefined || pkg.version === match.version);
};

/**
 * Run a phase's handlers left-to-right over a value (`packageJson` / `entry` / `resource`).
 * `undefined` is a no-op (keeps the accumulated value); at the `entry` phase a handler may
 * return `null` to drop the canonical, short-circuiting the rest and returning `null`.
 */
export const applyPatches = <T extends Record<string, unknown> | IndexEntry | Resource>(
    handlers: ((pkg: PackageId, value: T, report: PatchReportSink) => T | null | undefined)[] | undefined,
    pkg: PackageId,
    value: T,
    report: PatchReportSink,
): T | null => {
    let acc = value;
    for (const handler of handlers ?? []) {
        const result = handler(pkg, acc, report);
        if (result === null) return null;
        if (result !== undefined) acc = result;
    }
    return acc;
};

/**
 * An entry-phase handler that drops a canonical from the index: returns `null` when the URL
 * (and optional package) match, recording the reason in the report; otherwise no-op.
 */
export const excludeCanonical =
    (opts: { package?: PackageMatch; url: string; reason: string }): EntryPatch =>
    (pkg, entry, report) => {
        if (entry.url !== opts.url) return undefined;
        if (opts.package && !matchPackage(opts.package, pkg)) return undefined;
        report({ kind: "exclusion", package: pkg, url: opts.url, reason: opts.reason });
        return null;
    };

// ── Scoping combinators ──────────────────────────────────────────────────────

/** A non-dropping phase handler — `(pkg, value, report) => value | undefined`. */
type Handler<V> = (pkg: PackageId, value: V, report: PatchReportSink) => V | undefined;

/** Run `handlers` left-to-right over `value`; return the result only if something changed. */
const run = <V>(handlers: Handler<V>[], pkg: PackageId, value: V, report: PatchReportSink): V | undefined => {
    let acc = value;
    let changed = false;
    for (const handler of handlers) {
        const result = handler(pkg, acc, report);
        if (result !== undefined) {
            acc = result;
            changed = true;
        }
    }
    if (!changed) return undefined;
    return acc;
};

/** Apply `handlers` only to packages matching `match`. Works for package- and resource-phase
 *  handlers, and nests with `inResource`. */
export const inPackage = <V>(match: PackageMatch, handlers: Handler<V>[]): Handler<V> => {
    return (pkg, value, report) => {
        if (!matchPackage(match, pkg)) return undefined;
        return run(handlers, pkg, value, report);
    };
};

/** Apply resource `handlers` only to the resource with the given canonical `url`. */
export const inResource = (url: string, handlers: ResourcePatch[]): ResourcePatch => {
    return (pkg, resource, report) => {
        if (resource.url !== url) return undefined;
        return run(handlers, pkg, resource, report);
    };
};

// ── Transform helpers ────────────────────────────────────────────────────────

/**
 * Replace every occurrence of `from` with `to` throughout the serialized resource body — the
 * one tool for typo'd canonicals, wrong reference targets, and bindings that point at an
 * unavailable ValueSet. Blunt by design (a plain string replace); scope it with
 * `inPackage`/`inResource` so it can't touch anything else, and list it several times for
 * several substitutions.
 */
export const replaceText =
    (from: string, to: string): ResourcePatch =>
    (_pkg, resource) => {
        const str = JSON.stringify(resource);
        if (!str.includes(from)) return undefined;
        return JSON.parse(str.replaceAll(from, to));
    };

/**
 * Ensure a CodeSystem (matched by `url`) declares each code — missing ones are appended as bare
 * concepts, existing concepts are never touched. No-op if the resource isn't that CodeSystem or
 * already declares every code.
 */
export const ensureCodes =
    (url: string, codes: string[]): ResourcePatch =>
    (_pkg, resource) => {
        if (resource.resourceType !== "CodeSystem" || resource.url !== url) return undefined;
        const concept = (resource as { concept?: { code: string }[] }).concept;
        if (!concept) return undefined;
        const existing = new Set(concept.map((c) => c.code));
        const missing = codes.filter((code) => !existing.has(code));
        if (missing.length === 0) return undefined;
        return { ...resource, concept: [...concept, ...missing.map((code) => ({ code }))] };
    };

/**
 * Ensure the manifest declares each dependency at the given version — adds missing entries and
 * adjusts mismatched versions (unlike `injectDependency`, which never touches declared deps).
 * A package is never given itself as a dependency, so it needs no `inPackage` scoping.
 */
export const ensureDependency =
    (deps: Record<string, string>): PackagePatch =>
    (pkg, pkgJson) => {
        const existing = (pkgJson.dependencies as Record<string, string> | undefined) ?? {};
        const updates = Object.entries(deps).filter(
            ([name, version]) => name !== pkg.name && existing[name] !== version,
        );
        if (updates.length === 0) return undefined;
        return { ...pkgJson, dependencies: { ...existing, ...Object.fromEntries(updates) } };
    };

/** Rename a package whose manifest name is a typo. No-op for every other package. */
export const renamePackage =
    (from: string, to: string): PackagePatch =>
    (pkg, pkgJson) => {
        if (pkg.name !== from) return undefined;
        return { ...pkgJson, name: to };
    };
