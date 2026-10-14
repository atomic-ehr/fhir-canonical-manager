import { mock } from "bun:test";
import { buildWorker } from "../../scripts/browser-worker.js";

// Source-level Bun tests use the same in-memory Worker build as the published browser entry.
const worker = await buildWorker();
mock.module("virtual:fcm-worker", () => ({ workerSource: worker.code }));
