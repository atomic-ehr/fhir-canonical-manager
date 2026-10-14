/**
 * Per-run application of the `indexEntry` phase.
 *
 * The cached index is keyed by the package set alone, so managers with different patches
 * share one record and it has to stay raw. Patches cannot be keyed instead — handlers are
 * closures whose captured options are not recoverable for hashing.
 */

import { applyPatches } from "../patches.js";
import type { EntryPatch, IndexEntry, PackageId, PatchReportSink } from "../types/index.js";

export interface IndexReference {
    packageName: string;
    packageVersion: string;
    resourceType: string;
    url?: string;
    version?: string;
}

export interface CanonicalIndex<M extends IndexReference = IndexReference> {
    entries: Record<string, IndexEntry[]>;
    referenceManager: {
        getAllReferences(): Record<string, M>;
        clear(): void;
        set(id: string, metadata: M): void;
    };
}

/** Reference metadata wins: it is the identity `read()` scopes `fhirResource` patches by,
 *  while `entry.package` is itself patchable and optional. */
const packageOf = (entry: IndexEntry, metadata: IndexReference | undefined): PackageId | undefined =>
    metadata ? { name: metadata.packageName, version: metadata.packageVersion } : entry.package;

/**
 * Fold the handlers over the populated cache, rebuilding the url index and reference manager
 * from what survives. A handler may drop an entry or rewrite it, including its `url`.
 *
 * Ids are never recomputed. The adapter owns their identity and location metadata; both
 * are carried through when an entry is rewritten.
 */
export const applyIndexEntryPatches = <M extends IndexReference>(
    cache: CanonicalIndex<M>,
    handlers: EntryPatch[] | undefined,
    report: PatchReportSink,
): void => {
    if (!handlers?.length) return;

    // `getAllReferences` returns the manager's own record and `clear()` empties it in place.
    const priorMetadata = { ...cache.referenceManager.getAllReferences() };

    const entries: Record<string, IndexEntry[]> = Object.create(null);
    const survivors: [string, M][] = [];

    // Re-pushed in read order, so an unchanged index rebuilds identically — `resolveEntry`
    // picks by position within a bucket.
    for (const bucket of Object.values(cache.entries)) {
        for (const entry of bucket) {
            const metadata = priorMetadata[entry.id];
            const pkg = packageOf(entry, metadata);
            // Unscopable entries pass through rather than match against every package.
            const patched = pkg ? applyPatches(handlers, pkg, entry, report) : entry;
            if (patched === null) continue;

            const url = patched.url;
            if (!url) continue; // as in the scanner: absent from the url index means not committed

            (entries[url] ??= []).push(patched);
            if (metadata) {
                survivors.push([
                    patched.id,
                    { ...metadata, resourceType: patched.resourceType, url, version: patched.version },
                ]);
            }
        }
    }

    cache.entries = entries;

    // `set` only appends to the url index and there is no removal, so a re-keyed or dropped
    // entry can only be expressed by rebuilding.
    cache.referenceManager.clear();
    for (const [id, metadata] of survivors) cache.referenceManager.set(id, metadata);
};
