/**
 * Reference management exports
 */

export { generateReferenceId } from './store';
export { createReferenceManager } from './manager';
export type { ReferenceManager } from './manager';

// For backward compatibility - function alias (will be deprecated)
export { createReferenceManager as ReferenceManagerFactory } from './manager';