import { defineConfig } from "tsdown";
import { browserWorkerPlugin } from "./scripts/browser-worker.js";

export default defineConfig([
    {
        name: "Node",
        entry: { index: "src/index.ts", patches: "src/patches.ts", "cli/index": "src/cli/index.ts" },
        outDir: "dist",
        platform: "node",
        format: "esm",
        fixedExtension: false,
        sourcemap: true,
        dts: { sourcemap: true },
        deps: { neverBundle: true },
        exports: false,
        tsconfig: "tsconfig.build.json",
    },
    {
        name: "Browser",
        entry: { index: "src/browser/index.ts" },
        outDir: "dist/browser",
        platform: "browser",
        format: "esm",
        fixedExtension: false,
        sourcemap: true,
        dts: { sourcemap: true },
        deps: { neverBundle: true },
        exports: false,
        tsconfig: "tsconfig.build.json",
        plugins: [browserWorkerPlugin()],
    },
]);
