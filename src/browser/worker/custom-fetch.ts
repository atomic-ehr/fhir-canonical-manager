import type { Fetch } from "../fetch.js";
import type { HostMethods, WorkerMethods } from "../protocol.js";
import type { createRpc } from "../rpc.js";

/** Only custom host fetch callbacks cross the boundary; ordinary fetch stays here. */
export function customFetch(rpc: ReturnType<typeof createRpc<HostMethods, WorkerMethods>>): Fetch {
    return async (input, init) => {
        const signal = init?.signal ?? undefined;
        const response = await rpc.call(
            "fetchOpen",
            {
                url: input instanceof Request ? input.url : String(input),
                method: init?.method ?? "GET",
                headers: [...new Headers(init?.headers).entries()],
            },
            signal,
        );
        const abort = () => {
            void rpc.call("fetchCancel", { id: response.id }).catch(() => undefined);
        };
        signal?.addEventListener("abort", abort, { once: true });
        const cleanup = () => signal?.removeEventListener("abort", abort);
        const body = response.hasBody
            ? new ReadableStream<Uint8Array>({
                  async pull(controller) {
                      try {
                          const bytes = await rpc.call("fetchRead", { id: response.id }, signal);
                          if (bytes === null) {
                              cleanup();
                              controller.close();
                          } else controller.enqueue(bytes);
                      } catch (error) {
                          cleanup();
                          abort();
                          controller.error(error);
                      }
                  },
                  async cancel() {
                      cleanup();
                      await rpc.call("fetchCancel", { id: response.id });
                  },
              })
            : null;
        if (!body) cleanup();
        const result = new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
        Object.defineProperties(result, {
            url: { value: response.url },
            redirected: { value: response.redirected },
            type: { value: response.type },
        });
        return result;
    };
}
