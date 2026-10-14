import type { Progress } from "./protocol.js";

export function notifyProgress(
    observer: ((progress: Progress) => void | Promise<void>) | undefined,
    progress: Progress,
    signal: AbortSignal,
) {
    if (!observer || signal.aborted) return;
    try {
        void Promise.resolve(observer(progress)).catch(() => {});
    } catch {
        // An observational callback cannot fail or delay preparation.
    }
}
