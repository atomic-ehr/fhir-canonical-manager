export default (globalThis as unknown as { process: Record<string, unknown> }).process;
