/**
 * Reference management exports
 */

export { generateReferenceId } from './store.js';
export { createReferenceManager } from './manager.js';
export type { ReferenceManager } from './manager.js';

// For backward compatibility - function alias (will be deprecated)
export { createReferenceManager as ReferenceManagerFactory } from './manager.js';