/**
 * Per-run application of the `indexEntry` patch phase.
 *
 * The index on disk is keyed by the package set alone, so it must stay a faithful
 * picture of what those packages ship: two managers over the same packages with
 * different patches share one record. Applying the phase here — after the index is
 * populated, whether it was scanned or loaded — keeps the persisted index raw and
 * gives each manager its own view. Patches cannot be fingerprinted into the cache key
 * because handlers are closures whose captured options are not recoverable.
 */

import type { ExtendedCache } from "../cache.js";
import { applyPatches } from "../patches.js";
import type { EntryPatch, IndexEntry, PackageId, PatchReportSink, ReferenceMetadata } from "../types/index.js";

/**
 * The package an entry belongs to, for scoping a patch.
 *
 * The reference metadata is authoritative: `commitEntries` writes it from the scanned
 * `package.json`, so it is the identity `read()` later scopes `fhirResource` patches by.
 * `entry.package` is a patchable field and optional, so it is only a fallback.
 */
const packageOf = (entry: IndexEntry, metadata: ReferenceMetadata | undefined): PackageId | undefined =>
    metadata ? { name: metadata.packageName, version: metadata.packageVersion } : entry.package;

/**
 * Fold the `indexEntry` handlers over the populated cache, rebuilding the url index and
 * the reference manager from what survives.
 *
 * A handler may drop an entry (`null`), or rewrite it — including its `url`, which re-keys
 * the entry and has to be mirrored into the reference metadata. Nothing here recomputes a
 * reference id: ids are derived from the scanning process's cwd, so the cached ones are the
 * only correct ones, and the metadata they key (notably `filePath`) is carried through
 * untouched.
 */
export const applyIndexEntryPatches = (
    cache: ExtendedCache,
    handlers: EntryPatch[] | undefined,
    report: PatchReportSink,
): void => {
    if (!handlers?.length) return;

    // `getAllReferences` hands back the manager's own record and `clear()` empties it in
    // place, so this has to be a copy — reading it after the clear would yield nothing.
    const priorMetadata = { ...cache.referenceManager.getAllReferences() };

    const entries: Record<string, IndexEntry[]> = {};
    const survivors: [string, ReferenceMetadata][] = [];

    // Bucket iteration order is insertion order, and entries are re-pushed in the order
    // they are read, so an unchanged index rebuilds identically — `resolveEntry` picks by
    // position within a bucket.
    for (const bucket of Object.values(cache.entries)) {
        for (const entry of bucket) {
            const metadata = priorMetadata[entry.id];
            const pkg = packageOf(entry, metadata);
            // Without an identity a handler cannot be scoped, so the entry passes through
            // rather than being matched against every package.
            const patched = pkg ? applyPatches(handlers, pkg, entry, report) : entry;
            if (patched === null) continue;

            // Matches the scanner: an entry with no url is absent from the url index, so it
            // is not committed at all rather than left unresolvable.
            const url = patched.url;
            if (!url) continue;

            (entries[url] ??= []).push(patched);
            if (metadata) {
                survivors.push([
                    patched.id,
                    {
                        ...metadata,
                        resourceType: patched.resourceType,
                        url,
                        version: patched.version,
                    },
                ]);
            }
        }
    }

    cache.entries = entries;

    // `set` only ever appends to the url index and there is no removal, so a re-keyed or
    // dropped entry can only be expressed by rebuilding the whole manager.
    cache.referenceManager.clear();
    for (const [id, metadata] of survivors) cache.referenceManager.set(id, metadata);
};
