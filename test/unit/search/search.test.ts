import { describe, test, expect } from "bun:test";
import { expandedTerms, filterBySmartSearch } from "../../../src/search";
import type { IndexEntry } from "../../../src/types";

describe("Search Module", () => {
    describe("expandedTerms", () => {
        test("should contain common FHIR abbreviations", () => {
            expect(expandedTerms["str"]).toContain("structure");
            expect(expandedTerms["pati"]).toContain("patient");
            expect(expandedTerms["obs"]).toContain("observation");
            expect(expandedTerms["org"]).toContain("organization");
            expect(expandedTerms["pract"]).toContain("practitioner");
            expect(expandedTerms["med"]).toContain("medication");
            expect(expandedTerms["cs"]).toContain("codesystem");
            expect(expandedTerms["vs"]).toContain("valueset");
            expect(expandedTerms["sd"]).toContain("structuredefinition");
        });

        test("should have array values for all terms", () => {
            Object.entries(expandedTerms).forEach(([key, value]) => {
                expect(Array.isArray(value)).toBe(true);
                expect(value.length).toBeGreaterThan(0);
            });
        });
    });

    describe("filterBySmartSearch", () => {
        const createEntry = (url: string, type?: string, resourceType?: string): IndexEntry => ({
            id: `id-${url}`,
            url,
            type,
            resourceType: resourceType || "StructureDefinition",
            indexVersion: 1,
        });

        const testEntries: IndexEntry[] = [
            createEntry("http://hl7.org/fhir/StructureDefinition/Patient", "Patient"),
            createEntry("http://hl7.org/fhir/StructureDefinition/Observation", "Observation"),
            createEntry("http://hl7.org/fhir/StructureDefinition/Organization", "Organization"),
            createEntry("http://hl7.org/fhir/StructureDefinition/Practitioner", "Practitioner"),
            createEntry("http://hl7.org/fhir/StructureDefinition/Medication", "Medication"),
            createEntry("http://hl7.org/fhir/CodeSystem/patient-contact", "CodeSystem", "CodeSystem"),
            createEntry("http://hl7.org/fhir/ValueSet/patient-status", "ValueSet", "ValueSet"),
            createEntry("http://example.com/custom-patient-profile", "Patient"),
        ];

        test("should return all entries when no search terms", () => {
            const results = filterBySmartSearch(testEntries, []);
            expect(results).toEqual(testEntries);
        });

        test("should filter by exact match", () => {
            const results = filterBySmartSearch(testEntries, ["patient"]);

            expect(results).toHaveLength(4); // Includes custom-patient-profile
            expect(results.map((r) => r.url)).toContain("http://hl7.org/fhir/StructureDefinition/Patient");
            expect(results.map((r) => r.url)).toContain("http://hl7.org/fhir/CodeSystem/patient-contact");
            expect(results.map((r) => r.url)).toContain("http://hl7.org/fhir/ValueSet/patient-status");
            expect(results.map((r) => r.url)).toContain("http://example.com/custom-patient-profile");
        });

        test("should filter by prefix match", () => {
            const results = filterBySmartSearch(testEntries, ["obser"]);

            expect(results).toHaveLength(1);
            expect(results[0]?.url).toBe("http://hl7.org/fhir/StructureDefinition/Observation");
        });

        test("should expand abbreviations", () => {
            const results = filterBySmartSearch(testEntries, ["pati"]);

            expect(results).toHaveLength(4); // All patient-related entries
            expect(results.map((r) => r.type || "")).toContain("Patient");
        });

        test("should handle multiple search terms (AND logic)", () => {
            const results = filterBySmartSearch(testEntries, ["patient", "status"]);

            expect(results).toHaveLength(1);
            expect(results[0]?.url).toBe("http://hl7.org/fhir/ValueSet/patient-status");
        });

        test("should match on type field", () => {
            const results = filterBySmartSearch(testEntries, ["medication"]);

            expect(results).toHaveLength(1);
            expect(results[0]?.type).toBe("Medication");
        });

        test("should match on resourceType field", () => {
            const results = filterBySmartSearch(testEntries, ["codesystem"]);

            expect(results).toHaveLength(1);
            expect(results[0]?.resourceType).toBe("CodeSystem");
        });

        test("should handle substring matching as fallback", () => {
            const results = filterBySmartSearch(testEntries, ["contact"]);

            expect(results).toHaveLength(1);
            expect(results[0]?.url).toContain("patient-contact");
        });

        test("should be case insensitive", () => {
            const results1 = filterBySmartSearch(testEntries, ["PATIENT"]);
            const results2 = filterBySmartSearch(testEntries, ["patient"]);
            const results3 = filterBySmartSearch(testEntries, ["PaTiEnT"]);

            expect(results1).toEqual(results2);
            expect(results2).toEqual(results3);
        });

        test("should handle entries without URLs", () => {
            const entriesWithNull: IndexEntry[] = [
                ...testEntries,
                {
                    id: "no-url",
                    resourceType: "Patient",
                    indexVersion: 1,
                    // no url
                },
            ];

            const results = filterBySmartSearch(entriesWithNull, ["patient"]);

            // Should filter out entry without URL
            expect(results.every((r) => r.url)).toBe(true);
        });

        test("should handle special characters in URLs", () => {
            const specialEntries: IndexEntry[] = [
                createEntry("http://hl7.org/fhir/StructureDefinition/patient-animal"),
                createEntry("http://hl7.org/fhir/StructureDefinition/patient.birthPlace"),
                createEntry("http://hl7.org/fhir/StructureDefinition/patient_citizenship"),
            ];

            const results = filterBySmartSearch(specialEntries, ["animal"]);

            expect(results).toHaveLength(1);
            expect(results[0]?.url).toContain("patient-animal");
        });

        test("should expand common abbreviations correctly", () => {
            const csEntry = createEntry("http://hl7.org/fhir/CodeSystem/test", "CodeSystem", "CodeSystem");
            const vsEntry = createEntry("http://hl7.org/fhir/ValueSet/test", "ValueSet", "ValueSet");
            const sdEntry = createEntry("http://hl7.org/fhir/StructureDefinition/test", "StructureDefinition");

            const entries = [csEntry, vsEntry, sdEntry];

            expect(filterBySmartSearch(entries, ["cs"])).toContain(csEntry);
            expect(filterBySmartSearch(entries, ["vs"])).toContain(vsEntry);
            expect(filterBySmartSearch(entries, ["sd"])).toContain(sdEntry);
        });

        test("should handle empty search term", () => {
            const results = filterBySmartSearch(testEntries, [""]);

            // Empty string should match everything (substring match)
            expect(results).toEqual(testEntries);
        });

        test("should handle no matches", () => {
            const results = filterBySmartSearch(testEntries, ["xyz123"]);

            expect(results).toHaveLength(0);
        });

        test("should handle complex multi-term searches", () => {
            const entries: IndexEntry[] = [
                createEntry("http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient", "Patient"),
                createEntry("http://hl7.org/fhir/us/core/StructureDefinition/us-core-observation", "Observation"),
                createEntry("http://hl7.org/fhir/StructureDefinition/Patient", "Patient"),
            ];

            // Search for US Core Patient
            const results = filterBySmartSearch(entries, ["us", "core", "patient"]);

            expect(results).toHaveLength(1);
            expect(results[0]?.url).toContain("us-core-patient");
        });
    });
});
