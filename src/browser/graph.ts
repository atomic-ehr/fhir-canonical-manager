import type { PackageId, PackageJson } from "../types/index.js";
import type { Snapshot } from "./protocol.js";

export interface PackageNode {
    pkg: PackageId;
    transport: PackageId;
    scope: string;
    linkTarget?: PackageNode;
    packageJson: PackageJson;
    dependencies: Map<string, PackageNode>;
}
export function restoreGraph(snapshot: Snapshot) {
    const locations = new Map(
        snapshot.nodes.map((node) => [
            node.scope,
            {
                pkg: node.pkg,
                transport: node.transport,
                scope: node.scope,
                packageJson: node.packageJson,
                dependencies: new Map<string, PackageNode>(),
            } as PackageNode,
        ]),
    );
    const at = (scope: string): PackageNode => {
        const node = locations.get(scope);
        if (!node) throw new Error(`Invalid FHIR snapshot location ${scope}`);
        return node;
    };
    for (const node of snapshot.nodes) {
        const target = at(node.scope);
        if (node.linkTarget !== undefined) target.linkTarget = at(node.linkTarget);
        for (const edge of node.dependencies) target.dependencies.set(edge.name, at(edge.target));
    }
    return { nodes: [...locations.values()], roots: snapshot.roots.map(at), installed: snapshot.installed };
}

/** Canonicals lack a package name: walk declared upstream edges and explicit links. */
export function dependencyLevels(node: PackageNode): PackageNode[][] {
    const seen = new Set<PackageNode>();
    const levels: PackageNode[][] = [];
    let next = [node];
    while (next.length) {
        const current = [...new Set(next)].filter((candidate) => !seen.has(candidate));
        if (!current.length) break;
        for (const candidate of current) seen.add(candidate);
        levels.push(current);
        next = current.flatMap((candidate) => [...(candidate.linkTarget ?? candidate).dependencies.values()]);
    }
    return levels;
}
