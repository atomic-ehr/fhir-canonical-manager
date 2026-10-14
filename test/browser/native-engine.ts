/// <reference path="../../src/browser/worker/vendor.d.ts" />

import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Arborist from "@npmcli/arborist";

const path = await realpath(await mkdtemp(join(tmpdir(), "fcm-native-graph-")));
const registry = process.argv[2] as string;
await writeFile(
    `${path}/package.json`,
    JSON.stringify({
        name: "fcm-graph-root",
        version: "1.0.0",
        private: true,
        dependencies: JSON.parse(process.argv[3] as string),
    }),
);
const tree = await new Arborist({
    path,
    registry,
    cache: `${path}/cache`,
    packageLockOnly: true,
    ignoreScripts: true,
    ignoreExtension: true,
    audit: false,
    fund: false,
    binLinks: false,
    fetchRetries: 0,
    packumentCache: new Map(),
    nodeVersion: process.version,
}).buildIdealTree();
const graph = [...tree.inventory.values()]
    .filter((node) => node.location !== "")
    .map((node) => ({
        scope: node.location,
        name: node.name,
        version: node.package.version,
        linkTarget: node.isLink ? node.target?.location : undefined,
        dependencies: [...node.edgesOut.values()]
            .flatMap((edge) => {
                if (!edge.to && edge.optional && edge.valid) return [];
                return [{ name: edge.name, target: edge.to?.location }];
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.scope.localeCompare(b.scope));
const absentEdges = [...tree.inventory.values()]
    .flatMap((node) => [...node.edgesOut.values()])
    .filter((edge) => !edge.to)
    .map((edge) => ({ name: edge.name, optional: edge.optional, valid: edge.valid, error: edge.error }));
console.log(JSON.stringify({ nodeVersion: process.version, graph, absentEdges }));
