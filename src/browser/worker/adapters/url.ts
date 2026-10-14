import legacy from "url-browser";
export default {
    ...legacy,
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    pathToFileURL: (path: string) => new URL(`file://${path}`),
    fileURLToPath: (url: string | URL) => decodeURIComponent(new URL(url).pathname),
};
