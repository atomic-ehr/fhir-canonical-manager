import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as afs from "node:fs";
import * as Path from "node:path";
import { parseArgs } from "../src/cli/index";
import { searchCommand } from "../src/cli/search";
import { catchConsole, changeWorkDir, writeCacheIndex, writePackage } from "./utils";

// Helper to create mock package-lock.json and calculate its hash
const _createMockPackageLock = (testDir: string): string => {
    const packageLockContent = JSON.stringify({ lockfileVersion: 2, mockData: "test" }, null, 2);
    afs.writeFileSync(Path.join(testDir, "package-lock.json"), packageLockContent);
    return createHash("sha256").update(packageLockContent).digest("hex");
};

describe("CLI parseArgs", () => {
    test("should parse short aliases for resource types", () => {
        const { options: sdOptions } = parseArgs(["-sd"]);
        expect(sdOptions.resourceType).toBe("StructureDefinition");

        const { options: csOptions } = parseArgs(["-cs"]);
        expect(csOptions.resourceType).toBe("CodeSystem");

        const { options: vsOptions } = parseArgs(["-vs"]);
        expect(vsOptions.resourceType).toBe("ValueSet");
    });

    test("should parse short aliases with other arguments", () => {
        const { positional, options } = parseArgs(["-sd", "patient", "--limit", "5"]);
        expect(options.resourceType).toBe("StructureDefinition");
        expect(positional).toEqual(["patient"]);
        expect(options.limit).toBe("5");
    });

    test("should handle multiple positional arguments for prefix search", () => {
        const { positional, options } = parseArgs(["str", "def", "pat"]);
        expect(positional).toEqual(["str", "def", "pat"]);
        expect(options).toEqual({});
    });

    test("should parse mixed arguments correctly", () => {
        const { positional, options } = parseArgs(["-sd", "str", "def", "pat", "--json"]);
        expect(options.resourceType).toBe("StructureDefinition");
        expect(positional).toEqual(["str", "def", "pat"]);
        expect(options.json).toBe(true);
    });

    test("should parse -t and -k options", () => {
        const { options: tOptions } = parseArgs(["-t", "Extension"]);
        expect(tOptions.t).toBe("Extension");

        const { options: kOptions } = parseArgs(["-k", "resource"]);
        expect(kOptions.k).toBe("resource");

        const { options: combinedOptions } = parseArgs(["-t", "Patient", "-k", "resource", "-sd"]);
        expect(combinedOptions.t).toBe("Patient");
        expect(combinedOptions.k).toBe("resource");
        expect(combinedOptions.resourceType).toBe("StructureDefinition");
    });
});

describe("CLI search output format", () => {
    test("should output results in single-line format", async () => {
        const consoleOutput = await catchConsole(async () => {
            const testDir = Path.join(process.cwd(), "tmp", `test-search-format-${Date.now()}`);

            await changeWorkDir(testDir, async () => {
                writePackage({
                    name: "test-project",
                    fcm: {
                        packages: ["hl7.fhir.r4.core@4.0.1"],
                    },
                });
                writeCacheIndex(["hl7.fhir.r4.core@4.0.1"], {
                    packages: [
                        {
                            name: "hl7.fhir.r4.core",
                            version: "4.0.1",
                        },
                    ],
                    entries: {
                        "http://hl7.org/fhir/StructureDefinition/Patient": [
                            {
                                url: "http://hl7.org/fhir/StructureDefinition/Patient",
                                resourceType: "StructureDefinition",
                                kind: "resource",
                                type: "Patient",
                                package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                                id: "test-id-1",
                            },
                        ],
                        "http://hl7.org/fhir/StructureDefinition/patient-animal": [
                            {
                                url: "http://hl7.org/fhir/StructureDefinition/patient-animal",
                                resourceType: "StructureDefinition",
                                kind: "complex-type",
                                type: "Extension",
                                package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                                id: "test-id-2",
                            },
                        ],
                    },
                    references: {
                        "test-id-1": {
                            path: "StructureDefinition-Patient.json",
                            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                        },
                        "test-id-2": {
                            path: "StructureDefinition-patient-animal.json",
                            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                        },
                    },
                });
                await searchCommand(["pat"]);
            });
        });

        // Verify output format
        const output = consoleOutput.join("\n");
        expect(output).toContain('Found 2 resources matching "pat":');
        expect(output).toContain(
            'http://hl7.org/fhir/StructureDefinition/Patient, {"resourceType":"StructureDefinition","kind":"resource","type":"Patient","package":"hl7.fhir.r4.core"}',
        );
        expect(output).toContain(
            'http://hl7.org/fhir/StructureDefinition/patient-animal, {"resourceType":"StructureDefinition","kind":"complex-type","type":"Extension","package":"hl7.fhir.r4.core"}',
        );

        // Verify JSON structure is valid
        const lines = output.split("\n").filter((line) => line.includes(", {"));
        lines.forEach((line) => {
            const jsonPart = line.substring(line.indexOf(", {") + 2);
            expect(() => JSON.parse(jsonPart)).not.toThrow();
            const parsed = JSON.parse(jsonPart);
            expect(parsed).toHaveProperty("resourceType");
            expect(parsed).toHaveProperty("kind");
            expect(parsed).toHaveProperty("type");
            expect(parsed).toHaveProperty("package");
        });
    });

    test("should handle empty results gracefully", async () => {
        const consoleOutput = await catchConsole(async () => {
            const testDir = Path.join(process.cwd(), "tmp", `test-empty-search-${Date.now()}`);

            await changeWorkDir(testDir, async () => {
                writePackage({
                    name: "test-project",
                    fcm: {
                        packages: ["hl7.fhir.r4.core@4.0.1"],
                    },
                });
                writeCacheIndex(["hl7.fhir.r4.core@4.0.1"], {
                    packages: [{ name: "hl7.fhir.r4.core", version: "4.0.1" }],
                    entries: {},
                    references: {},
                });
                await searchCommand(["xyz"]);
            });
        });
        const output = consoleOutput.join("\n");
        expect(output).toContain("No resources found");
    });

    test("should filter by type using -t option", async () => {
        const consoleOutput = await catchConsole(async () => {
            const testDir = Path.join(process.cwd(), "tmp", `test-type-filter-${Date.now()}`);

            await changeWorkDir(testDir, async () => {
                writePackage({
                    name: "test-project",
                    fcm: {
                        packages: ["hl7.fhir.r4.core@4.0.1"],
                    },
                });
                writeCacheIndex(["hl7.fhir.r4.core@4.0.1"], {
                    packages: [
                        {
                            name: "hl7.fhir.r4.core",
                            version: "4.0.1",
                        },
                    ],
                    entries: {
                        "http://hl7.org/fhir/StructureDefinition/Patient": [
                            {
                                url: "http://hl7.org/fhir/StructureDefinition/Patient",
                                resourceType: "StructureDefinition",
                                kind: "resource",
                                type: "Patient",
                                package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                                id: "test-id-1",
                            },
                        ],
                        "http://hl7.org/fhir/StructureDefinition/patient-animal": [
                            {
                                url: "http://hl7.org/fhir/StructureDefinition/patient-animal",
                                resourceType: "StructureDefinition",
                                kind: "complex-type",
                                type: "Extension",
                                package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                                id: "test-id-2",
                            },
                        ],
                        "http://hl7.org/fhir/StructureDefinition/patient-birthPlace": [
                            {
                                url: "http://hl7.org/fhir/StructureDefinition/patient-birthPlace",
                                resourceType: "StructureDefinition",
                                kind: "complex-type",
                                type: "Extension",
                                package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                                id: "test-id-3",
                            },
                        ],
                    },
                    references: {
                        "test-id-1": {
                            path: "StructureDefinition-Patient.json",
                            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                        },
                        "test-id-2": {
                            path: "StructureDefinition-patient-animal.json",
                            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                        },
                        "test-id-3": {
                            path: "StructureDefinition-patient-birthPlace.json",
                            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                        },
                    },
                });
                await searchCommand(["-t", "Extension"]);
            });
        });
        const output = consoleOutput.join("\n");
        expect(output).toContain("Found 2 resources");
        expect(output).toContain("patient-animal");
        expect(output).toContain("patient-birthPlace");
        expect(output).not.toContain("StructureDefinition/Patient,"); // Should not include Patient resource
    });

    test("should filter by kind using -k option", async () => {
        const consoleOutput = await catchConsole(async () => {
            const testDir = Path.join(process.cwd(), "tmp", `test-kind-filter-${Date.now()}`);
            await changeWorkDir(testDir, async () => {
                writePackage({
                    name: "test-project",
                    fcm: {
                        packages: ["hl7.fhir.r4.core@4.0.1"],
                    },
                });
                writeCacheIndex(["hl7.fhir.r4.core@4.0.1"], {
                    packages: [
                        {
                            name: "hl7.fhir.r4.core",
                            version: "4.0.1",
                        },
                    ],
                    entries: {
                        "http://hl7.org/fhir/StructureDefinition/Patient": [
                            {
                                url: "http://hl7.org/fhir/StructureDefinition/Patient",
                                resourceType: "StructureDefinition",
                                kind: "resource",
                                type: "Patient",
                                package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                                id: "test-id-1",
                            },
                        ],
                        "http://hl7.org/fhir/StructureDefinition/HumanName": [
                            {
                                url: "http://hl7.org/fhir/StructureDefinition/HumanName",
                                resourceType: "StructureDefinition",
                                kind: "complex-type",
                                type: "HumanName",
                                package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                                id: "test-id-2",
                            },
                        ],
                        "http://hl7.org/fhir/StructureDefinition/string": [
                            {
                                url: "http://hl7.org/fhir/StructureDefinition/string",
                                resourceType: "StructureDefinition",
                                kind: "primitive-type",
                                type: "string",
                                package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                                id: "test-id-3",
                            },
                        ],
                    },
                    references: {
                        "test-id-1": {
                            path: "StructureDefinition-Patient.json",
                            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                        },
                        "test-id-2": {
                            path: "StructureDefinition-HumanName.json",
                            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                        },
                        "test-id-3": {
                            path: "StructureDefinition-string.json",
                            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
                        },
                    },
                });
                await searchCommand(["-k", "resource"]);
            });
        });
        const output = consoleOutput.join("\n");
        expect(output).toContain("Found 1 resource");
        expect(output).toContain("Patient");
        expect(output).not.toContain("HumanName");
        expect(output).not.toContain("string");
    });
});
