import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CanonicalManager } from "../../../src";
import type { PreprocessContext } from "../../../src/types";

const TEST_CANONICAL = "http://example.org/fhir/StructureDefinition/TestProfile";

describe("preprocessPackage with kind: resource", () => {
	const tmpRoot = path.join(process.cwd(), "tmp", "preprocess-resource-tests");
	const workingDir = path.join(tmpRoot, "working-dir");
	const localPackagePath = path.join(tmpRoot, "local-package");
	const resourceFilePath = path.join(localPackagePath, "StructureDefinition-TestProfile.json");

	const originalResource = {
		resourceType: "StructureDefinition",
		id: "TestProfile",
		url: TEST_CANONICAL,
		name: "TestProfile",
		description: "Original description",
	};

	beforeAll(async () => {
		await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
		await fs.mkdir(localPackagePath, { recursive: true });

		await fs.writeFile(
			path.join(localPackagePath, "package.json"),
			JSON.stringify({ name: "test.package", version: "1.0.0" }),
		);
		await fs.writeFile(
			path.join(localPackagePath, ".index.json"),
			JSON.stringify({
				"index-version": 1,
				files: [
					{
						filename: "StructureDefinition-TestProfile.json",
						resourceType: "StructureDefinition",
						id: "TestProfile",
						url: TEST_CANONICAL,
						kind: "resource",
						type: "StructureDefinition",
					},
				],
			}),
		);
		await fs.writeFile(resourceFilePath, JSON.stringify(originalResource));
	});

	afterAll(async () => {
		await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
	});

	test("should modify resources returned by read()", async () => {
		const manager = CanonicalManager({
			packages: [],
			workingDir,
			preprocessPackage: (ctx: PreprocessContext): PreprocessContext => {
				if (ctx.kind !== "resource") return ctx;
				return {
					...ctx,
					resource: { ...ctx.resource, description: "Modified description" },
				};
			},
		});

		await manager.addLocalPackage({
			name: "test.package",
			version: "1.0.0",
			path: localPackagePath,
		});
		await manager.init();

		const resource = await manager.resolve(TEST_CANONICAL);
		expect(resource.description).toBe("Modified description");
		await manager.destroy();
	});

	test("should modify resources returned by search()", async () => {
		const manager = CanonicalManager({
			packages: [],
			workingDir: path.join(tmpRoot, "working-dir-search"),
			preprocessPackage: (ctx: PreprocessContext): PreprocessContext => {
				if (ctx.kind !== "resource") return ctx;
				return {
					...ctx,
					resource: { ...ctx.resource, description: "Search modified" },
				};
			},
		});

		await manager.addLocalPackage({
			name: "test.package",
			version: "1.0.0",
			path: localPackagePath,
		});
		await manager.init();

		const results = await manager.search({ url: TEST_CANONICAL });
		expect(results).toHaveLength(1);
		expect(results[0]?.description).toBe("Search modified");
		await manager.destroy();
	});

	test("should not modify original file on disk", async () => {
		const manager = CanonicalManager({
			packages: [],
			workingDir: path.join(tmpRoot, "working-dir-disk"),
			preprocessPackage: (ctx: PreprocessContext): PreprocessContext => {
				if (ctx.kind !== "resource") return ctx;
				return {
					...ctx,
					resource: { ...ctx.resource, description: "Disk test modified" },
				};
			},
		});

		await manager.addLocalPackage({
			name: "test.package",
			version: "1.0.0",
			path: localPackagePath,
		});
		await manager.init();

		const resource = await manager.resolve(TEST_CANONICAL);
		expect(resource.description).toBe("Disk test modified");

		// File on disk should remain unchanged
		const fileContent = JSON.parse(await fs.readFile(resourceFilePath, "utf-8"));
		expect(fileContent.description).toBe("Original description");
		await manager.destroy();
	});

	test("should receive correct package info in context", async () => {
		let receivedPackage: { name: string; version: string } | undefined;

		const manager = CanonicalManager({
			packages: [],
			workingDir: path.join(tmpRoot, "working-dir-pkg"),
			preprocessPackage: (ctx: PreprocessContext): PreprocessContext => {
				if (ctx.kind !== "resource") return ctx;
				receivedPackage = ctx.package;
				return ctx;
			},
		});

		await manager.addLocalPackage({
			name: "test.package",
			version: "1.0.0",
			path: localPackagePath,
		});
		await manager.init();

		await manager.resolve(TEST_CANONICAL);
		expect(receivedPackage).toEqual({ name: "test.package", version: "1.0.0" });
		await manager.destroy();
	});

	test("should handle both package and resource kinds in one hook", async () => {
		const manager = CanonicalManager({
			packages: [],
			workingDir: path.join(tmpRoot, "working-dir-both"),
			preprocessPackage: (ctx: PreprocessContext): PreprocessContext => {
				if (ctx.kind === "package") {
					// Pass through package preprocessing unchanged
					return ctx;
				}
				if (ctx.kind === "resource") {
					return {
						...ctx,
						resource: { ...ctx.resource, description: "Both kinds work" },
					};
				}
				return ctx;
			},
		});

		await manager.addLocalPackage({
			name: "test.package",
			version: "1.0.0",
			path: localPackagePath,
		});
		await manager.init();

		const resource = await manager.resolve(TEST_CANONICAL);
		expect(resource.description).toBe("Both kinds work");
		await manager.destroy();
	});
});
