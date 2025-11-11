/**
 * FHIR Canonical Manager - Modular Implementation
 * A package manager for FHIR resources with canonical URL resolution
 */

// Re-export all public types
export * from "./types/index.js";

// Re-export reference management
export { createReferenceManager, ReferenceManagerFactory as ReferenceManager } from "./reference/index.js";
export type { ReferenceManager as ReferenceManagerType } from "./reference/index.js";

// Re-export main CanonicalManager factory and class
export { CanonicalManager, createCanonicalManager } from "./manager/index.js";

// Re-export CanonicalManager type interface with T prefix
export type { CanonicalManager as TCanonicalManager } from "./types/core.js";

// Default export for backward compatibility
import { createCanonicalManager } from "./manager/index.js";
export default createCanonicalManager;
