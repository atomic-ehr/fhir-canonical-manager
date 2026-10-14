import { deserializeError, type SerializedError, serializeError } from "./protocol.js";

type Method = { input: unknown; output: unknown };
type Methods<T> = { [K in keyof T]: Method };
type Handlers<T extends Methods<T>> = { [K in keyof T]: (input: T[K]["input"]) => Promise<T[K]["output"]> };
type Message =
    | { type: "request"; id: number; method: string; input: unknown }
    | { type: "reply"; id: number; output?: unknown; error?: SerializedError };
export interface Endpoint {
    postMessage(message: Message): void;
    addEventListener(type: "message", listener: (event: MessageEvent<Message>) => void): void;
    removeEventListener(type: "message", listener: (event: MessageEvent<Message>) => void): void;
}

/** One bidirectional channel; handlers exchange data, never executable callbacks. */
export function createRpc<Outgoing extends Methods<Outgoing>, Incoming extends Methods<Incoming>>(
    endpoint: Endpoint,
    handlers: Handlers<Incoming>,
) {
    let sequence = 0;
    let closed: Error | undefined;
    const pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>();
    const listener = async ({ data }: MessageEvent<Message>) => {
        if (closed) return;
        if (data.type === "reply") {
            const request = pending.get(data.id);
            if (!request) return;
            pending.delete(data.id);
            if (data.error) request.reject(deserializeError(data.error));
            else request.resolve(data.output);
            return;
        }
        if (data.type !== "request") return;
        try {
            const handler = handlers[data.method as keyof Incoming];
            if (!handler) throw new Error(`Unsupported FHIR Worker request: ${data.method}`);
            const output = await handler(data.input);
            if (!closed) endpoint.postMessage({ type: "reply", id: data.id, output });
        } catch (error) {
            if (!closed) endpoint.postMessage({ type: "reply", id: data.id, error: serializeError(error) });
        }
    };
    endpoint.addEventListener("message", listener);
    return {
        call<K extends keyof Outgoing & string>(
            method: K,
            input: Outgoing[K]["input"],
            signal?: AbortSignal,
        ): Promise<Outgoing[K]["output"]> {
            return new Promise((resolve, reject) => {
                if (closed) return reject(closed);
                if (signal?.aborted) return reject(signal.reason);
                const id = ++sequence;
                const abort = () => {
                    pending.delete(id);
                    reject(signal?.reason);
                };
                const cleanup = () => signal?.removeEventListener("abort", abort);
                pending.set(id, {
                    resolve(value) {
                        cleanup();
                        resolve(value as Outgoing[K]["output"]);
                    },
                    reject(error) {
                        cleanup();
                        reject(error);
                    },
                });
                signal?.addEventListener("abort", abort, { once: true });
                try {
                    endpoint.postMessage({ type: "request", id, method, input });
                } catch (error) {
                    pending.delete(id);
                    cleanup();
                    reject(error);
                }
            });
        },
        close(reason = new Error("FHIR Worker is closed")) {
            if (closed) return;
            closed = reason;
            endpoint.removeEventListener("message", listener);
            for (const request of pending.values()) request.reject(reason);
            pending.clear();
        },
    };
}
