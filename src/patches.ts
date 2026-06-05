/**
 * Composable patches: transform/filter packages, index entries, and resources.
 */

import type { EntryPatch, IndexEntry, PackageId, PatchReportSink, Resource } from "./types/index.js";

/** Match a package by exact name, name+version, or a predicate. */
export type PackageMatch = string | { name: string; version?: string } | ((pkg: PackageId) => boolean);

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
