import posix from "path-browserify";

const win32 = new Proxy({} as typeof posix.win32, {
    get: (_target, property) => () => {
        throw new Error(`Windows path API ${String(property)} is unsupported in the browser`);
    },
});
export default { ...posix, win32 };
