import { Buffer } from "buffer";
import { EventEmitter } from "events";
import browserProcess from "process/browser.js";
import "setimmediate";
import { serializeError } from "../protocol.js";

// Bun's native DecompressionStream reads its host binding internally. Browsers have none.
const hostProcess = (globalThis as unknown as { process?: { binding?: (name: string) => unknown } }).process;
const hostBinding = hostProcess?.binding?.bind(hostProcess);
// These globals are private to the Worker; upstream npm modules expect them.
Object.assign(globalThis, {
    Buffer,
    global: globalThis,
    process: Object.assign(new EventEmitter(), browserProcess, {
        version: "v26.8.1",
        versions: { node: "26.8.1" },
        platform: "browser",
        arch: "unknown",
        cwd: () => "/work/app",
        env: {},
        pid: 1,
        stdout: { isTTY: false },
        stderr: { isTTY: false },
        ...(hostBinding ? { binding: hostBinding } : {}),
    }),
});
void import("./runtime.js").catch((error) => postMessage({ type: "fatal", error: serializeError(error) }));
