import { Buffer } from "buffer";
import { Minipass } from "minipass";
import { Response } from "minipass-fetch";
import { getServices } from "../context.js";
export default async function metadataFetch(url: string, options: RequestInit = {}) {
    options.signal?.throwIfAborted();
    if ((options.method ?? "GET") !== "GET" || options.body != null)
        throw new Error("FHIR graph transport only supports metadata GET requests");
    const result = await getServices().metadata({
        url,
        method: options.method ?? "GET",
        headers: [...new Headers(options.headers).entries()],
    });
    options.signal?.throwIfAborted();
    const body = new Minipass<Buffer>();
    body.end(Buffer.from(result.bytes));
    return new Response(body, {
        status: result.status,
        statusText: result.statusText || "FHIR registry response",
        headers: result.headers,
        url: result.url,
    });
}
