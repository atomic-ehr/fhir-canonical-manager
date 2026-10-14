import { expect, test } from "bun:test";
import { build } from "tsdown";
import ts from "typescript";
import { browserWorkerPlugin, buildWorker } from "../../../scripts/browser-worker.js";

test("the browser entry bundles without filesystem, child process or crypto imports", async () => {
    // A separate process keeps this audit independent of Bun test's module-resolution cache.
    const bundleProcess = Bun.spawn({
        cmd: [
            Bun.argv[0] as string,
            "build",
            new URL("../../../dist/browser/index.js", import.meta.url).pathname,
            "--target=browser",
        ],
        stdout: "pipe",
        stderr: "pipe",
    });
    const [code, errors, exitCode] = await Promise.all([
        new Response(bundleProcess.stdout).text(),
        new Response(bundleProcess.stderr).text(),
        bundleProcess.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(errors).not.toMatch(/error:/);
    expect(code).not.toMatch(/\b(?:from|import)\s*["']node:|\brequire\s*\(["'](?:node:|fs|path|crypto|child_process)/);
    expect(code).not.toContain("createBrowserCanonicalManager");
});

test("the UI module graph excludes archive, index preparation and Node compatibility implementations", async () => {
    const { bundles } = await build({
        config: false,
        entry: ["src/browser/index.ts"],
        platform: "browser",
        format: "esm",
        dts: false,
        write: false,
        clean: false,
        exports: false,
        logLevel: "warn",
        deps: { neverBundle: true },
        plugins: [browserWorkerPlugin()],
    });
    const inputs = bundles.flatMap((bundle) =>
        bundle.chunks.flatMap((chunk) => (chunk.type === "chunk" ? chunk.moduleIds : [])),
    );
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.some((path) => path.includes("src/browser/worker/"))).toBe(false);
    expect(inputs.some((path) => /node_modules\/(?:modern-tar|memfs|@npmcli\/arborist|pacote)\//.test(path))).toBe(
        false,
    );
});

test("the embedded Worker has no unresolved literal imports or Node builtin require calls", async () => {
    const { code } = await buildWorker();
    const source = ts.createSourceFile("worker.js", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const imports: string[] = [];
    const builtinLoads: string[] = [];
    function inspect(node: ts.Node): void {
        if (ts.isImportDeclaration(node)) imports.push(node.moduleSpecifier.getText(source));
        if (ts.isCallExpression(node)) {
            const argument = node.arguments[0];
            if (node.expression.kind === ts.SyntaxKind.ImportKeyword && argument && ts.isStringLiteral(argument))
                imports.push(argument.text);
            if (
                ts.isIdentifier(node.expression) &&
                node.expression.text === "require" &&
                argument &&
                ts.isStringLiteral(argument) &&
                /^(?:node:|fs$|path$|crypto$|child_process$|http$|https$|net$|tls$)/.test(argument.text)
            )
                builtinLoads.push(argument.text);
        }
        ts.forEachChild(node, inspect);
    }
    inspect(source);
    expect(imports).toEqual([]);
    expect(builtinLoads).toEqual([]);
});
