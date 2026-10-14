import { expect, test } from "bun:test";

test("the shared core bundles for a browser without Node APIs or runtime polyfills", async () => {
    // A separate process keeps this audit independent of Bun test's module-resolution cache.
    const bundleProcess = Bun.spawn({
        cmd: [
            Bun.argv[0] as string,
            "build",
            new URL("../../../src/core/index.ts", import.meta.url).pathname,
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
    expect(code).not.toMatch(/node:|\brequire\s*\(|\bprocess\.|\bBuffer\b|\bBun\b/);
});
