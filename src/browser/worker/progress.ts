import type { PackageId } from "../../types/index.js";
import type { DownloadProgress, Progress } from "../protocol.js";

/** One notification batch per 100 ms across concurrent preparation phases. */
export function createProgress(send: (updates: Progress[]) => void, signal: AbortSignal) {
    const pending = new Map<string, Progress>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    function flush() {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        if (!signal.aborted && pending.size) send([...pending.values()]);
        pending.clear();
    }
    function close() {
        closed = true;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        pending.clear();
        signal.removeEventListener("abort", close);
    }
    signal.addEventListener("abort", close, { once: true });
    return {
        report(progress: Progress) {
            if (closed || signal.aborted) return;
            const pkg = "package" in progress ? progress.package : undefined;
            pending.set(
                JSON.stringify([
                    progress.phase,
                    pkg?.name,
                    pkg?.version,
                    "done" in progress ? progress.done : undefined,
                ]),
                progress,
            );
            timer ??= setTimeout(flush, 100);
        },
        flush,
        close,
    };
}

export function downloadReporter(response: Response, pkg: PackageId, report: (progress: DownloadProgress) => void) {
    const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
    const length = response.headers.get("content-length");
    // CORS may hide Content-Encoding while exposing the encoded Content-Length.
    // A missing encoding header is only conclusive for an unfiltered Response.
    const comparable = encoding === "identity" || (!encoding && response.type !== "cors");
    let totalBytes = comparable && length !== null && /^\d+$/.test(length) ? Number(length) : undefined;
    if (totalBytes !== undefined && !Number.isSafeInteger(totalBytes)) totalBytes = undefined;
    return (receivedBytes: number, done: boolean) => {
        if (totalBytes !== undefined && (receivedBytes > totalBytes || (done && receivedBytes !== totalBytes)))
            totalBytes = undefined;
        report({
            phase: "download",
            package: { ...pkg },
            receivedBytes,
            ...(totalBytes === undefined ? {} : { totalBytes }),
            done,
        });
    };
}
