// Upstream eagerly sizes its default cache. Jobs supply a Map instead of that cache.
export default { getHeapStatistics: () => ({ heap_size_limit: 64 * 1024 * 1024 }) };
