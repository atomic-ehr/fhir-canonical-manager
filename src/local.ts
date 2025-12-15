import * as afs from "node:fs/promises";
import * as Path from "node:path";
import { ensureDir, fileExists } from "./fs/index.js";
import { isPathSpec, parsePackageRef } from "./manager/package-spec.js";
import { installPackages } from "./package.js";
import type { LocalPackageConfig, PackageId } from "./types/index.js";

const parseDependencySpec = (spec: string): { name: string; version: string } | undefined => {
    const trimmed = spec.trim();
    if (!trimmed || isPathSpec(trimmed) || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        return undefined;
    }

    try {
        return parsePackageRef(trimmed);
    } catch {
        return undefined;
    }
};

interface IndexFileEntry {
    filename: string;
    resourceType: string;
    id: string;
    url?: string;
    version?: string;
    kind?: string;
    type?: string;
}

interface IndexFile {
    "index-version": number;
    files: IndexFileEntry[];
}

interface FhirResource {
    resourceType?: string;
    id?: string;
    url?: string;
    version?: string;
    kind?: string;
    type?: string;
}

export const installTgzPackage = async (
    archivePath: string,
    destPath: string,
    registry?: string,
): Promise<PackageId> => {
    if (!(await fileExists(archivePath))) {
        throw new Error(`TGZ archive not found: ${archivePath}`);
    }

    await installPackages([archivePath], destPath, registry);

    const rootPackageJsonPath = Path.join(destPath, "package.json");
    const rootPackageJson = JSON.parse(await afs.readFile(rootPackageJsonPath, "utf-8"));
    const dependencies = rootPackageJson.dependencies || {};

    for (const [depName, depVersion] of Object.entries(dependencies)) {
        if (depVersion === archivePath || (depVersion as string).includes(archivePath)) {
            const pkgPath = depName.startsWith("@")
                ? Path.join(destPath, "node_modules", ...depName.split("/"))
                : Path.join(destPath, "node_modules", depName);

            const pkgJsonPath = Path.join(pkgPath, "package.json");
            if (await fileExists(pkgJsonPath)) {
                const pkgJson = JSON.parse(await afs.readFile(pkgJsonPath, "utf-8"));
                return { name: pkgJson.name, version: pkgJson.version };
            }
        }
    }

    const nodeModulesPath = Path.join(destPath, "node_modules");
    const entries = await afs.readdir(nodeModulesPath, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pkgPath = Path.join(nodeModulesPath, entry.name);
        const pkgJsonPath = Path.join(pkgPath, "package.json");

        if (await fileExists(pkgJsonPath)) {
            const pkgJson = JSON.parse(await afs.readFile(pkgJsonPath, "utf-8"));
            if (await fileExists(Path.join(pkgPath, ".index.json"))) {
                return { name: pkgJson.name, version: pkgJson.version };
            }
        }
    }

    throw new Error(`Failed to identify installed package from tgz: ${archivePath}`);
};

export const generateIndexJson = async (targetPath: string): Promise<void> => {
    const files: IndexFileEntry[] = [];
    const entries = await afs.readdir(targetPath, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".json")) continue;
        if (entry.name === "package.json" || entry.name === ".index.json") continue;

        const filePath = Path.join(targetPath, entry.name);

        try {
            const content = await afs.readFile(filePath, "utf-8");
            const resource: FhirResource = JSON.parse(content);

            if (!resource.resourceType || !resource.id) continue;

            const indexEntry: IndexFileEntry = {
                filename: entry.name,
                resourceType: resource.resourceType,
                id: resource.id,
            };

            if (resource.url) indexEntry.url = resource.url;
            if (resource.version) indexEntry.version = resource.version;

            if (resource.resourceType === "StructureDefinition") {
                if (resource.kind) indexEntry.kind = resource.kind;
                if (resource.type) indexEntry.type = resource.type;
            }

            files.push(indexEntry);
        } catch (e) {
            console.error("Error while creating index.json", e);
        }
    }

    if (files.length === 0) {
        throw new Error(`No valid FHIR resources found in folder: ${targetPath}`);
    }

    const indexFile: IndexFile = {
        "index-version": 1,
        files,
    };

    await afs.writeFile(Path.join(targetPath, ".index.json"), JSON.stringify(indexFile, null, 2));
};

export const installLocalFolder = async (config: LocalPackageConfig, destPath: string): Promise<PackageId> => {
    const { name, version, path: sourcePath } = config;

    if (!(await fileExists(sourcePath))) {
        throw new Error(`Local package folder not found: ${sourcePath}`);
    }

    const nodeModulesPath = Path.join(destPath, "node_modules");
    const targetPath = name.startsWith("@")
        ? Path.join(nodeModulesPath, ...name.split("/"))
        : Path.join(nodeModulesPath, name);

    await afs.rm(targetPath, { recursive: true, force: true });

    await ensureDir(Path.dirname(targetPath));

    await afs.cp(sourcePath, targetPath, { recursive: true });

    const packageJsonPath = Path.join(targetPath, "package.json");
    let packageJson: Record<string, unknown>;
    if (await fileExists(packageJsonPath)) {
        packageJson = JSON.parse(await afs.readFile(packageJsonPath, "utf-8"));
        packageJson.name = packageJson.name ?? name;
        packageJson.version = packageJson.version ?? version;
        packageJson.private = true;
    } else {
        packageJson = {
            name,
            version,
            private: true,
        };
    }

    if (!packageJson.dependencies) {
        packageJson.dependencies = {};
    }

    const dependencyMap = packageJson.dependencies as Record<string, string>;
    if (config.dependencies) {
        for (const dep of config.dependencies) {
            const parsed = parseDependencySpec(dep);
            if (!parsed) continue;
            if (!dependencyMap[parsed.name]) {
                dependencyMap[parsed.name] = parsed.version;
            }
        }
    }

    await afs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    const indexJsonPath = Path.join(targetPath, ".index.json");
    if (!(await fileExists(indexJsonPath))) {
        await generateIndexJson(targetPath);
    }

    return { name, version };
};
