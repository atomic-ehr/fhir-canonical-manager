import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ensureDir, fileExists } from "../../../src/fs";

describe("File System Utilities", () => {
    let tempDir: string;

    beforeEach(async () => {
        // Create a temporary directory for testing
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-test-"));
    });

    afterEach(async () => {
        // Clean up temporary directory
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe("fileExists", () => {
        test("should return true for existing file", async () => {
            const filePath = path.join(tempDir, "test.txt");
            await fs.writeFile(filePath, "test content");

            const exists = await fileExists(filePath);
            expect(exists).toBe(true);
        });

        test("should return false for non-existing file", async () => {
            const filePath = path.join(tempDir, "non-existent.txt");

            const exists = await fileExists(filePath);
            expect(exists).toBe(false);
        });

        test("should return true for existing directory", async () => {
            const dirPath = path.join(tempDir, "test-dir");
            await fs.mkdir(dirPath);

            const exists = await fileExists(dirPath);
            expect(exists).toBe(true);
        });

        test("should handle permission errors gracefully", async () => {
            // This test might not work on all systems
            const filePath = "/root/cannot-access";

            const exists = await fileExists(filePath);
            expect(exists).toBe(false);
        });
    });

    describe("ensureDir", () => {
        test("should create a new directory", async () => {
            const dirPath = path.join(tempDir, "new-dir");

            await ensureDir(dirPath);

            const stats = await fs.stat(dirPath);
            expect(stats.isDirectory()).toBe(true);
        });

        test("should create nested directories", async () => {
            const dirPath = path.join(tempDir, "level1", "level2", "level3");

            await ensureDir(dirPath);

            const stats = await fs.stat(dirPath);
            expect(stats.isDirectory()).toBe(true);
        });

        test("should not throw if directory already exists", async () => {
            const dirPath = path.join(tempDir, "existing-dir");
            await fs.mkdir(dirPath);

            // Should not throw
            await ensureDir(dirPath);

            const stats = await fs.stat(dirPath);
            expect(stats.isDirectory()).toBe(true);
        });

        test("should handle file existing at path gracefully", async () => {
            const filePath = path.join(tempDir, "file.txt");
            await fs.writeFile(filePath, "content");

            // Should not throw, but also won't create directory
            await ensureDir(filePath);

            const stats = await fs.stat(filePath);
            expect(stats.isFile()).toBe(true);
        });
    });
});
