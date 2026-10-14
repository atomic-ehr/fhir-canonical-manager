function delay<T>(ms: number, value?: T, { signal }: { signal?: AbortSignal } = {}): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve(value);
        }, ms);
        const abort = () => {
            clearTimeout(timer);
            reject(signal?.reason);
        };
        signal?.addEventListener("abort", abort, { once: true });
    });
}
export default { setTimeout: delay };
