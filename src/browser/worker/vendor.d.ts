// Type the small upstream surfaces used by our adapters; vendors remain untouched.
declare module "@npmcli/arborist" {
    class Arborist {
        constructor(options: Record<string, unknown>);
        buildIdealTree(): Promise<import("./arborist.js").ArboristTree>;
    }
    export default Arborist;
}
declare module "pacote-original" {
    const pacote: Record<string, unknown> & {
        manifest(spec: unknown, options: unknown): Promise<import("../protocol.js").SelectedManifest>;
    };
    export default pacote;
}
declare module "process/browser.js" {
    const process: Record<string, unknown>;
    export default process;
}
declare module "path-browserify" {
    const path: typeof import("node:path");
    export default path;
}
declare module "constants-browserify" {
    const constants: Record<string, number>;
    export default constants;
}
declare module "url-browser" {
    const url: typeof import("node:url");
    export default url;
}
declare module "minipass-fetch" {
    class Response {
        constructor(
            body: unknown,
            options: { status: number; statusText: string; headers: [string, string][]; url: string },
        );
    }
    export { Response };
}
