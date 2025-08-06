/**
 * FHIR Canonical Manager - Modular Implementation
 * A package manager for FHIR resources with canonical URL resolution
 */

// Re-export all public types
export * from './types/index.js';

// Re-export reference management
export { createReferenceManager, ReferenceManagerFactory as ReferenceManager } from './reference/index.js';
export type { ReferenceManager as ReferenceManagerType } from './reference/index.js';

// Re-export main CanonicalManager
export { CanonicalManager, createCanonicalManager } from './manager/index.js';

// Type export for CanonicalManager (the interface is already exported from types)
// CanonicalManager function is exported from manager as a factory function

// Default export for backward compatibility
import { createCanonicalManager } from './manager/index.js';
export default createCanonicalManager;