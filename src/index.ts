/**
 * FHIR Canonical Manager - Modular Implementation
 * A package manager for FHIR resources with canonical URL resolution
 */

// Re-export main CanonicalManager factory (CanonicalManager is a backward-compatible alias)
export { createCanonicalManager, createCanonicalManager as CanonicalManager } from "./manager/canonical.js";
// Composable patches are exposed via the "@atomic-ehr/fhir-canonical-manager/patch" subpath (src/patches.ts).
export type { ReferenceManager as ReferenceManagerType } from "./reference.js";
// Re-export reference management (ReferenceManager is a backward-compatible alias)
export { createReferenceManager, createReferenceManager as ReferenceManager } from "./reference.js";
// Re-export CanonicalManager type interface with T prefix
export type { CanonicalManager as TCanonicalManager } from "./types/core.js";
// Re-export all public types
export * from "./types/index.js";
