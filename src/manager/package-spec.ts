import * as Path from "node:path";
import type { PackageId } from "../types/index.js";

export const isPathSpec = (spec: string): boolean => {
    return spec.startsWith("./") || spec.startsWith("../") || Path.isAbsolute(spec);
};

export const normalizePackageSpec = (spec: string): string => {
    if (isPathSpec(spec)) {
        return Path.resolve(spec);
    }
    return spec;
};

export const parsePackageRef = (pkgRef: string): PackageId => {
    const trimmed = pkgRef.trim();
    if (!trimmed) {
        throw new Error(`Invalid FHIR package meta: ${pkgRef}`);
    }
    const atIndex = trimmed.lastIndexOf("@");
    if (atIndex > 0) {
        return {
            name: trimmed.slice(0, atIndex),
            version: trimmed.slice(atIndex + 1) || "latest",
        };
    }
    return {
        name: trimmed,
        version: "latest",
    };
};
