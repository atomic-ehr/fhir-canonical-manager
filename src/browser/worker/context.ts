import type { createFsFromVolume } from "memfs";
import type { PackageJson } from "../../types/index.js";
import type { MetadataRequest, MetadataResponse, SelectedManifest } from "../protocol.js";
export interface Services {
    metadata(request: MetadataRequest): Promise<MetadataResponse>;
    hydrate(manifest: SelectedManifest): Promise<PackageJson>;
}
let filesystem: ReturnType<typeof createFsFromVolume> | undefined;
let services: Services | undefined;
export function setFilesystem(value: ReturnType<typeof createFsFromVolume>): void {
    filesystem = value;
}
export function getFilesystem(): ReturnType<typeof createFsFromVolume> {
    if (!filesystem) throw new Error("FHIR Worker filesystem is not initialized");
    return filesystem;
}
export function setServices(value: Services): void {
    services = value;
}
export function getServices(): Services {
    if (!services) throw new Error("FHIR Worker package services are not initialized");
    return services;
}
