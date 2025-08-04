/**
 * FHIR Canonical Manager - Modular Implementation
 * A package manager for FHIR resources with canonical URL resolution
 */

// Re-export all public types
export * from './types';

// Re-export reference management
export { createReferenceManager, ReferenceManagerFactory as ReferenceManager } from './reference';
export type { ReferenceManager as ReferenceManagerType } from './reference';

// Re-export main CanonicalManager
export { CanonicalManager, createCanonicalManager } from './manager';

// Type export for CanonicalManager (the interface is already exported from types)
// CanonicalManager function is exported from manager as a factory function

// Default export for backward compatibility
import { createCanonicalManager } from './manager';
export default createCanonicalManager;