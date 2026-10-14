export { isValidFileEntry, isValidIndexFile, parseIndex } from "./index-file.js";
export { applyIndexEntryPatches, type CanonicalIndex, type IndexReference } from "./index-patch.js";
export {
    type CanonicalQueryAdapter,
    createCanonicalQuery,
    type EntrySearchParams,
    filterEntryCandidates,
    type ResolveOptions,
} from "./query.js";
export {
    type CollectedResource,
    collectFromIndex,
    collectFromSource,
    type IndexLoadResult,
    type ResourceSource,
} from "./resource-index.js";
