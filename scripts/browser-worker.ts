import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build, type TsdownPlugin, type UserConfig } from "tsdown";

const require = createRequire(import.meta.url);
const workerModule = "virtual:fcm-worker";
const resolvedWorkerModule = `\0${workerModule}`;
const bridgePrefix = "\0fcm-node-export:";
const packages: Record<string, string> = {
    util: "util/",
    events: "events/",
    assert: "assert/",
    stream: "stream-browserify",
    crypto: "crypto-browserify",
    zlib: "browserify-zlib",
    buffer: "buffer/",
    string_decoder: "string_decoder/",
    querystring: "querystring-es3",
    "url-browser": "url/",
};
const adapters: Record<string, string> = {
    path: "path",
    "path/win32": "path-win32",
    fs: "fs",
    "fs/promises": "fs-promises",
    process: "process",
    os: "os",
    url: "url",
    v8: "v8",
    module: "module",
    "timers/promises": "timers-promises",
    "make-fetch-happen": "transport",
    pacote: "pacote",
};
const denied = new Set(["child_process", "http", "https", "http2", "net", "tls", "dns", "worker_threads"]);

function runtimeBoundary(): TsdownPlugin {
    return {
        name: "fcm-browser-runtime",
        resolveId: {
            order: "pre",
            handler(source) {
                const name = source.replace(/^node:/, "");
                if (name === "pacote-original") return require.resolve("pacote");
                const adapter = adapters[name] ?? (denied.has(name) ? "unsupported" : undefined);
                if (adapter) return `${bridgePrefix}${resolve(`src/browser/worker/adapters/${adapter}.ts`)}.cjs`;
                if (packages[name]) return require.resolve(packages[name]);
                return undefined;
            },
        },
        load(id) {
            if (!id.startsWith(bridgePrefix)) return undefined;
            // Upstream require() expects the adapter's default object/function, not an ESM namespace.
            return `module.exports = require(${JSON.stringify(id.slice(bridgePrefix.length, -4))}).default;`;
        },
    };
}

const workerConfig: UserConfig = {
    name: "FHIR Worker",
    entry: ["src/browser/worker/bootstrap.ts"],
    platform: "browser",
    format: "iife",
    dts: false,
    sourcemap: false,
    minify: true,
    clean: false,
    write: false,
    exports: false,
    deps: { alwaysBundle: () => true, onlyBundle: false, onlyImport: [] },
    plugins: [runtimeBoundary()],
    define: {
        "process.env.NODE_DEBUG": "undefined",
        __dirname: '"/__bundled__"',
        __filename: '"/__bundled__/worker.js"',
    },
    outputOptions: { codeSplitting: false, comments: { legal: true } },
};

export async function buildWorker() {
    const { bundles } = await build({ ...workerConfig, config: false, logLevel: "warn" });
    const chunks = bundles.flatMap((bundle) => bundle.chunks);
    const output = chunks[0];
    // Rolldown records inlined dynamic imports as edges to the current chunk.
    if (
        chunks.length !== 1 ||
        output?.type !== "chunk" ||
        output.imports.length ||
        output.dynamicImports.some((file) => file !== output.fileName)
    )
        throw new Error(
            `FHIR Worker must be a single self-contained JavaScript chunk: ${JSON.stringify(
                chunks.map((chunk) => ({
                    file: chunk.fileName,
                    type: chunk.type,
                    imports: chunk.type === "chunk" ? chunk.imports : [],
                    dynamicImports: chunk.type === "chunk" ? chunk.dynamicImports : [],
                })),
            )}`,
        );
    return { code: output.code, modules: output.moduleIds };
}

export function browserWorkerPlugin(): TsdownPlugin {
    let pending: ReturnType<typeof buildWorker> | undefined;
    return {
        name: "fcm-embedded-worker",
        buildStart() {
            pending = undefined;
        },
        resolveId(id) {
            if (id === workerModule) return resolvedWorkerModule;
        },
        async load(id) {
            if (id !== resolvedWorkerModule) return undefined;
            const worker = await (pending ??= buildWorker());
            for (const module of worker.modules) if (!module.startsWith("\0")) this.addWatchFile(module);
            return `export const workerSource = ${JSON.stringify(worker.code)};`;
        },
    };
}
