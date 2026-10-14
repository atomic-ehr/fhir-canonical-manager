import Arborist from "@npmcli/arborist";
import type { PackageJson } from "../../types/index.js";
import type { EngineNode } from "../protocol.js";
import { getFilesystem, type Services, setServices } from "./context.js";

export interface ArboristNode {
    name: string;
    location: string;
    package: PackageJson;
    isRoot: boolean;
    isWorkspace: boolean;
    isLink: boolean;
    target?: ArboristNode;
    edgesOut: Map<
        string,
        { name: string; to: ArboristNode | null; valid: boolean; optional: boolean; error: string | null }
    >;
}
export interface ArboristTree extends ArboristNode {
    inventory: Map<string, ArboristNode>;
}

export async function buildArboristGraph(
    config: Services & {
        registry: string;
        requests: { spec: string; name: string; version: string }[];
    },
): Promise<{ graph: EngineNode[]; installed: { spec: string; scope: string }[] }> {
    let rejectInvalid: (error: unknown) => void;
    const invalid = new Promise<never>((_resolve, reject) => {
        rejectInvalid = reject;
    });
    // npm may omit optional failures; provenance/identity/admission failures must fail the whole job.
    setServices({
        async metadata(request) {
            try {
                return await config.metadata(request);
            } catch (error) {
                rejectInvalid(error);
                throw error;
            }
        },
        async hydrate(manifest) {
            try {
                return await config.hydrate(manifest);
            } catch (error) {
                rejectInvalid(error);
                throw error;
            }
        },
    });
    const fs = getFilesystem();
    fs.mkdirSync("/work/app", { recursive: true });
    const dependencies: Record<string, string> = {};
    const workspaces: string[] = [];
    const roots: { spec: string; name: string; container: string }[] = [];
    for (const [index, request] of config.requests.entries()) {
        const repeated = config.requests.filter((other) => other.name === request.name).length > 1;
        let container = "";
        if (repeated) {
            container = `roots/${index}`;
            fs.mkdirSync(`/work/app/${container}`, { recursive: true });
            fs.writeFileSync(
                `/work/app/${container}/package.json`,
                JSON.stringify({
                    name: `fcm-request-${index}`,
                    version: "1.0.0",
                    private: true,
                    dependencies: { [request.name]: request.version },
                }),
            );
            workspaces.push(container);
        } else dependencies[request.name] = request.version;
        roots.push({ ...request, container });
    }
    fs.writeFileSync(
        "/work/app/package.json",
        JSON.stringify({ name: "fcm-graph-root", version: "1.0.0", private: true, dependencies, workspaces }),
    );
    const tree = await Promise.race([
        new Arborist({
            path: "/work/app",
            registry: config.registry,
            cache: "/work/cache",
            packageLockOnly: true,
            ignoreScripts: true,
            ignoreExtension: true,
            audit: false,
            fund: false,
            binLinks: false,
            fetchRetries: 0,
            packumentCache: new Map(),
            nodeVersion: "v26.8.1",
            nodeGyp: false,
        }).buildIdealTree(),
        invalid,
    ]);
    const nodes = [...tree.inventory.values()].filter(
        (node) => !node.isRoot && !node.isWorkspace && !(node.isLink && node.target?.isWorkspace),
    );
    if (nodes.length > 1_000) throw new Error("FHIR dependency graph exceeds 1000 installation locations");
    const ids = new Map(nodes.map((node) => [node, node.location]));
    const at = (node: ArboristNode | null | undefined): string => {
        const scope = node && ids.get(node);
        if (scope === undefined || scope === null) throw new Error("Invalid Arborist installation location");
        return scope;
    };
    const graph = nodes.map((node) => ({
        scope: at(node),
        name: node.name,
        version: node.package.version,
        linkTarget: node.isLink ? at(node.target) : undefined,
        dependencies: [...node.edgesOut.values()].flatMap((edge) => {
            if (!edge.to && edge.optional && edge.valid) return [];
            if (!edge.to || !edge.valid || !ids.has(edge.to))
                throw new Error(`Invalid FHIR dependency ${node.name} -> ${edge.name}: ${edge.error}`);
            return [{ name: edge.name, target: at(edge.to) }];
        }),
    }));
    return {
        graph,
        installed: roots.map((request) => {
            const node = request.container ? tree.inventory.get(request.container) : tree;
            return { spec: request.spec, scope: at(node?.edgesOut.get(request.name)?.to) };
        }),
    };
}
