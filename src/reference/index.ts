/**
 * Reference management exports
 */

export type { ReferenceManager } from "./manager.js";
// For backward compatibility - function alias (will be deprecated)
export { createReferenceManager, createReferenceManager as ReferenceManagerFactory } from "./manager.js";
export { generateReferenceId } from "./store.js";
