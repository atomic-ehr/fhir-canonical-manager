/**
 * FHIR Canonical Manager - Modular Implementation
 * A package manager for FHIR resources with canonical URL resolution
 */

// Re-export main CanonicalManager factory and class
export { CanonicalManager, createCanonicalManager } from "./manager/index.js";
export type { ReferenceManager as ReferenceManagerType } from "./reference.js";
// Re-export reference management
export { createReferenceManager, ReferenceManagerFactory as ReferenceManager } from "./reference.js";
// Re-export CanonicalManager type interface with T prefix
export type { CanonicalManager as TCanonicalManager } from "./types/core.js";
// Re-export all public types
export * from "./types/index.js";

// Default export for backward compatibility
import { createCanonicalManager } from "./manager/index.js";
export default createCanonicalManager;
