import { beforeEach, describe, expect, test } from "bun:test";
import { createReferenceManager, generateReferenceId } from "../../../src/reference";
import type { ReferenceMetadata } from "../../../src/types";

describe("Reference Module", () => {
    describe("generateReferenceId", () => {
        test("should generate consistent IDs for same input", () => {
            const metadata = {
                packageName: "test.package",
                packageVersion: "1.0.0",
                filePath: "/path/to/file.json",
            };

            const id1 = generateReferenceId(metadata);
            const id2 = generateReferenceId(metadata);

            expect(id1).toBe(id2);
            expect(typeof id1).toBe("string");
            expect(id1.length).toBeGreaterThan(0);
        });

        test("should generate different IDs for different inputs", () => {
            const metadata1 = {
                packageName: "test.package",
                packageVersion: "1.0.0",
                filePath: "/path/to/file1.json",
            };

            const metadata2 = {
                packageName: "test.package",
                packageVersion: "1.0.0",
                filePath: "/path/to/file2.json",
            };

            const id1 = generateReferenceId(metadata1);
            const id2 = generateReferenceId(metadata2);

            expect(id1).not.toBe(id2);
        });

        test("should generate URL-safe base64 IDs", () => {
            const metadata = {
                packageName: "test.package",
                packageVersion: "1.0.0",
                filePath: "/path/to/file.json",
            };

            const id = generateReferenceId(metadata);
            // URL-safe base64 should not contain +, /, or =
            expect(id).not.toMatch(/[+/=]/);
        });
    });

    describe("createReferenceManager", () => {
        let manager: ReturnType<typeof createReferenceManager>;

        beforeEach(() => {
            manager = createReferenceManager();
        });

        test("should create a reference manager", () => {
            expect(manager).toBeDefined();
            expect(manager.generateId).toBeDefined();
            expect(manager.get).toBeDefined();
            expect(manager.set).toBeDefined();
            expect(manager.has).toBeDefined();
            expect(manager.clear).toBeDefined();
            expect(manager.size).toBeDefined();
            expect(manager.getIdsByUrl).toBeDefined();
            expect(manager.createReference).toBeDefined();
            expect(manager.getAllReferences).toBeDefined();
        });

        test("should store and retrieve references", () => {
            const metadata: ReferenceMetadata = {
                packageName: "test.package",
                packageVersion: "1.0.0",
                filePath: "/path/to/file.json",
                resourceType: "Patient",
                url: "http://example.com/Patient",
                version: "1.0.0",
            };

            const id = "test-id";
            manager.set(id, metadata);

            expect(manager.has(id)).toBe(true);
            expect(manager.get(id)).toEqual(metadata);
            expect(manager.size()).toBe(1);
        });

        test("should track references by URL", () => {
            const metadata1: ReferenceMetadata = {
                packageName: "test.package",
                packageVersion: "1.0.0",
                filePath: "/path/to/file1.json",
                resourceType: "Patient",
                url: "http://example.com/Patient",
                version: "1.0.0",
            };

            const metadata2: ReferenceMetadata = {
                packageName: "test.package2",
                packageVersion: "2.0.0",
                filePath: "/path/to/file2.json",
                resourceType: "Patient",
                url: "http://example.com/Patient",
                version: "2.0.0",
            };

            manager.set("id1", metadata1);
            manager.set("id2", metadata2);

            const ids = manager.getIdsByUrl("http://example.com/Patient");
            expect(ids).toHaveLength(2);
            expect(ids).toContain("id1");
            expect(ids).toContain("id2");
        });

        test("should handle references without URLs", () => {
            const metadata: ReferenceMetadata = {
                packageName: "test.package",
                packageVersion: "1.0.0",
                filePath: "/path/to/file.json",
                resourceType: "Patient",
            };

            manager.set("id1", metadata);

            expect(manager.has("id1")).toBe(true);
            expect(manager.getIdsByUrl("http://example.com/Patient")).toHaveLength(0);
        });

        test("should clear all references", () => {
            const metadata: ReferenceMetadata = {
                packageName: "test.package",
                packageVersion: "1.0.0",
                filePath: "/path/to/file.json",
                resourceType: "Patient",
                url: "http://example.com/Patient",
            };

            manager.set("id1", metadata);
            manager.set("id2", metadata);

            expect(manager.size()).toBe(2);

            manager.clear();

            expect(manager.size()).toBe(0);
            expect(manager.has("id1")).toBe(false);
            expect(manager.has("id2")).toBe(false);
            expect(manager.getIdsByUrl("http://example.com/Patient")).toHaveLength(0);
        });

        test("should create reference objects", () => {
            const metadata: ReferenceMetadata = {
                packageName: "test.package",
                packageVersion: "1.0.0",
                filePath: "/path/to/file.json",
                resourceType: "Patient",
                url: "http://example.com/Patient",
            };

            const reference = manager.createReference("test-id", metadata);

            expect(reference).toEqual({
                id: "test-id",
                resourceType: "Patient",
            });
        });

        test("should return all references", () => {
            const metadata1: ReferenceMetadata = {
                packageName: "test.package",
                packageVersion: "1.0.0",
                filePath: "/path/to/file1.json",
                resourceType: "Patient",
            };

            const metadata2: ReferenceMetadata = {
                packageName: "test.package",
                packageVersion: "1.0.0",
                filePath: "/path/to/file2.json",
                resourceType: "Observation",
            };

            manager.set("id1", metadata1);
            manager.set("id2", metadata2);

            const allRefs = manager.getAllReferences();

            expect(Object.keys(allRefs)).toHaveLength(2);
            expect(allRefs["id1"]).toEqual(metadata1);
            expect(allRefs["id2"]).toEqual(metadata2);
        });

        test("should not add duplicate IDs to URL mapping", () => {
            const metadata: ReferenceMetadata = {
                packageName: "test.package",
                packageVersion: "1.0.0",
                filePath: "/path/to/file.json",
                resourceType: "Patient",
                url: "http://example.com/Patient",
            };

            // Set same ID multiple times
            manager.set("id1", metadata);
            manager.set("id1", metadata);
            manager.set("id1", metadata);

            const ids = manager.getIdsByUrl("http://example.com/Patient");
            expect(ids).toHaveLength(1);
            expect(ids[0]).toBe("id1");
        });
    });
});
