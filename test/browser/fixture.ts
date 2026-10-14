import { packTar } from "modern-tar";
import { maxSatisfying } from "semver";
import type { Fetch } from "../../src/browser/fetch.js";
import type { PackageJson } from "../../src/types/index.js";

export const patientUrl = "http://example.org/StructureDefinition/Patient";
export interface FixturePackage {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
    url?: string;
    marker?: string;
    files?: Record<string, string>;
    manifest?: Partial<PackageJson>;
}

export function packageFiles(pkg: FixturePackage): Record<string, string> {
    const url = pkg.url ?? patientUrl;
    return {
        "package.json": JSON.stringify({
            name: pkg.name,
            version: pkg.version,
            dependencies: pkg.dependencies ?? {},
            ...pkg.manifest,
        }),
        "Patient.json": JSON.stringify({
            resourceType: "StructureDefinition",
            id: "Patient",
            name: "Patient",
            url,
            version: `clinical-${pkg.version}`,
            kind: "resource",
            type: "Patient",
            marker: pkg.marker ?? `${pkg.name}@${pkg.version}`,
            baseDefinition: pkg.dependencies ? patientUrl : undefined,
        }),
        ...pkg.files,
    };
}

export async function archiveFiles(files: Record<string, string>): Promise<Uint8Array<ArrayBuffer>> {
    const tar = await packTar(
        Object.entries(files).map(([name, body]) => ({
            header: { name, size: new TextEncoder().encode(body).length },
            body,
        })),
    );
    return new Uint8Array(
        await new Response(new Blob([tar]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
    );
}

export async function packageArchive(pkg: FixturePackage): Promise<Uint8Array<ArrayBuffer>> {
    return archiveFiles(
        Object.fromEntries(Object.entries(packageFiles(pkg)).map(([name, content]) => [`package/${name}`, content])),
    );
}

export async function registryFixture(packages: FixturePackage[]) {
    const requests: string[] = [];
    const archives = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const pkg of packages) archives.set(`${pkg.name}@${pkg.version}`, await packageArchive(pkg));
    const checksums = new Map<string, string>();
    for (const [key, bytes] of archives) {
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", bytes));
        checksums.set(key, `sha512-${btoa(String.fromCharCode(...digest))}`);
    }
    const handle = (url: URL): Response => {
        requests.push(url.href);
        const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
        const name = parts.at(-2) ?? "";
        const version = parts.at(-1) ?? "";
        const archive = archives.get(`${name}@${version}`);
        if (archive) return new Response(archive, { headers: { "content-type": "application/gzip" } });
        const versions = packages.filter((pkg) => pkg.name === version).map((pkg) => pkg.version);
        if (versions.length)
            return Response.json({
                "dist-tags": { latest: maxSatisfying(versions, "*") },
                name: version,
                versions: Object.fromEntries(
                    versions.map((value) => [
                        value,
                        {
                            name: version,
                            version: value,
                            dist: {
                                tarball: `${url.origin}${url.pathname.replace(/\/$/, "")}/${value}`,
                                integrity: checksums.get(`${version}@${value}`),
                            },
                        },
                    ]),
                ),
            });
        return new Response("not found", { status: 404 });
    };
    const fetchImpl: Fetch = async (input) => handle(new URL(input instanceof Request ? input.url : String(input)));
    return { requests, fetch: fetchImpl, handle };
}
