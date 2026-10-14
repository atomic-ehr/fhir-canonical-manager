import type { PackageId, PackageJson } from "../../types/index.js";
import { parsePackageSpec, validateDependencies } from "../package-spec.js";
import { buildArboristGraph } from "./arborist.js";
import type { PackageContent } from "./archive.js";
import type { createRegistry } from "./registry.js";

export interface PackageNode {
    pkg: PackageId;
    transport: PackageId;
    scope: string;
    linkTarget?: PackageNode;
    packageJson: PackageJson;
    files: Record<string, string>;
    dependencies: Map<string, PackageNode>;
    reports: import("../../types/index.js").ReportEntry[];
}

export async function installGraph(
    specs: string[],
    source: ReturnType<ReturnType<typeof createRegistry>["session"]> & {
        patch(
            pkg: PackageId,
            manifest: PackageJson,
        ): Promise<{ manifest: PackageJson; reports: import("../../types/index.js").ReportEntry[] }>;
        signal?: AbortSignal;
        graphTimeoutMs?: number;
    },
): Promise<{ roots: PackageNode[]; nodes: PackageNode[]; installed: Record<string, PackageId> }> {
    const content = new Map<
        string,
        Promise<{ raw: PackageContent; patched: PackageJson; reports: import("../../types/index.js").ReportEntry[] }>
    >();
    const result = await buildArboristGraph({
        registry: source.registry,
        requests: specs.map((spec) => ({ spec, ...parsePackageSpec(spec) })),
        metadata: (request) => source.metadata(request, source.signal ?? new AbortController().signal),
        async hydrate(selected) {
            const key = `${selected.name}@${selected.version}`;
            let pending = content.get(key);
            if (!pending) {
                pending = (async () => {
                    const raw = await source.hydrate(selected, source.signal ?? new AbortController().signal);
                    const patch = await source.patch(
                        { name: selected.name, version: selected.version },
                        structuredClone(raw.packageJson),
                    );
                    const patched = patch.manifest;
                    if (
                        typeof patched.name !== "string" ||
                        !patched.name ||
                        typeof patched.version !== "string" ||
                        !patched.version
                    )
                        throw new Error("Package patches must retain a valid metadata name and version");
                    validateDependencies(patched);
                    return { raw, patched, reports: patch.reports };
                })();
                content.set(key, pending);
            }
            const record = await pending;
            return structuredClone(record.patched);
        },
    });
    const locations = new Map<string, PackageNode>();
    for (const node of result.graph) {
        const pending = content.get(`${node.name}@${node.version}`);
        if (!pending) throw new Error(`Missing verified FHIR content for ${node.name}@${node.version}`);
        const record = await pending;
        locations.set(node.scope, {
            pkg: { name: record.patched.name, version: record.patched.version },
            transport: { name: node.name, version: node.version },
            scope: node.scope,
            packageJson: structuredClone(record.patched),
            files: record.raw.files,
            dependencies: new Map(),
            reports: record.reports,
        });
    }
    const at = (scope: string) => {
        const node = locations.get(scope);
        if (!node) throw new Error(`Invalid Arborist graph location ${scope}`);
        return node;
    };
    for (const node of result.graph) {
        const target = at(node.scope);
        if (node.linkTarget !== undefined) target.linkTarget = at(node.linkTarget);
        for (const edge of node.dependencies) target.dependencies.set(edge.name, at(edge.target));
    }
    const roots = result.installed.map((root) => at(root.scope));
    return {
        roots,
        nodes: [...new Set([...roots, ...locations.values()])],
        installed: Object.fromEntries(result.installed.map((root) => [root.spec, at(root.scope).pkg])),
    };
}
