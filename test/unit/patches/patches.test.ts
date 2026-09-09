import { describe, expect, test } from "bun:test";
import {
    applyPatches,
    ensureCodes,
    ensureDependency,
    excludeCanonical,
    inPackage,
    inResource,
    matchPackage,
    renamePackage,
    replaceText,
} from "../../../src/patches";
import type { EntryPatch, IndexEntry, PackagePatch, PatchReportSink, ReportEntry } from "../../../src/types";

const mkSink = (): { report: PatchReportSink; entries: ReportEntry[] } => {
    const entries: ReportEntry[] = [];
    return { report: (e) => entries.push(e), entries };
};

const pkg = { name: "p", version: "1" };
const entry = (url: string): IndexEntry => ({ id: "x", resourceType: "StructureDefinition", indexVersion: 0, url });

describe("applyPatches", () => {
    test("applies handlers left-to-right", () => {
        const h1: PackagePatch = (_pkg, packageJson) => ({ ...packageJson, a: 1 });
        const h2: PackagePatch = (_pkg, packageJson) => ({ ...packageJson, b: 2 });
        const { report } = mkSink();
        const out = applyPatches([h1, h2], pkg, {}, report);
        expect(out).toEqual({ a: 1, b: 2 });
    });

    test("null at the entry phase short-circuits and skips later handlers", () => {
        let called = false;
        const drop: EntryPatch = () => null;
        const after: EntryPatch = () => {
            called = true;
            return undefined;
        };
        const { report } = mkSink();
        expect(applyPatches([drop, after], pkg, entry("u"), report)).toBeNull();
        expect(called).toBe(false);
    });

    test("undefined is a no-op (keeps the accumulated value)", () => {
        const noop: EntryPatch = () => undefined;
        const { report } = mkSink();
        const e = entry("u");
        expect(applyPatches([noop], pkg, e, report)).toBe(e);
    });

    test("no handlers is a no-op", () => {
        const { report } = mkSink();
        const e = entry("u");
        expect(applyPatches(undefined, pkg, e, report)).toBe(e);
    });
});

describe("excludeCanonical", () => {
    test("drops a matching entry and notes the report", () => {
        const { report, entries } = mkSink();
        const result = excludeCanonical({ url: "http://ex/Bad", reason: "R5 type" })(
            pkg,
            entry("http://ex/Bad"),
            report,
        );
        expect(result).toBeNull();
        expect(entries).toEqual([{ kind: "exclusion", package: pkg, url: "http://ex/Bad", reason: "R5 type" }]);
    });

    test("no-ops on a non-matching url", () => {
        const { report, entries } = mkSink();
        const patch = excludeCanonical({ url: "http://ex/Bad", reason: "x" });
        expect(patch(pkg, entry("http://ex/Good"), report)).toBeUndefined();
        expect(entries).toHaveLength(0);
    });

    test("respects the package filter", () => {
        const { report } = mkSink();
        const patch = excludeCanonical({ package: "other", url: "http://ex/Bad", reason: "x" });
        expect(patch(pkg, entry("http://ex/Bad"), report)).toBeUndefined();
    });
});

describe("matchPackage", () => {
    test("matches by string, object, and predicate", () => {
        expect(matchPackage("p", pkg)).toBe(true);
        expect(matchPackage("q", pkg)).toBe(false);
        expect(matchPackage({ name: "p", version: "1" }, pkg)).toBe(true);
        expect(matchPackage({ name: "p", version: "2" }, pkg)).toBe(false);
        expect(matchPackage((x) => x.version === "1", pkg)).toBe(true);
    });
});

describe("helper factories", () => {
    const noReport: PatchReportSink = () => undefined;

    test("ensureDependency adds missing and adjusts mismatched versions, never self", () => {
        const patch = ensureDependency({ "hl7.fhir.r4.core": "4.0.1", p: "9.9.9" });

        const result = patch(
            pkg,
            { name: "p", dependencies: { "hl7.fhir.r4.core": "4.0.0", other: "1.0.0" } },
            noReport,
        );
        expect(result?.dependencies).toEqual({ "hl7.fhir.r4.core": "4.0.1", other: "1.0.0" });

        const matching = patch(pkg, { name: "p", dependencies: { "hl7.fhir.r4.core": "4.0.1" } }, noReport);
        expect(matching).toBeUndefined();
    });

    test("renamePackage renames only the matching package", () => {
        const patch = renamePackage("p", "q");

        expect(patch(pkg, { name: "p" }, noReport)).toEqual({ name: "q" });
        expect(patch({ name: "r", version: "1" }, { name: "r" }, noReport)).toBeUndefined();
    });

    test("replaceText substitutes throughout the body, no-op without a match", () => {
        const patch = replaceText("http://a/IVL_TS", "http://a/IVL-TS");
        const resource = { resourceType: "StructureDefinition", url: "http://a/IVL_TS", base: "http://a/IVL_TS" };

        expect(patch(pkg, resource as never, noReport) as unknown).toEqual({
            resourceType: "StructureDefinition",
            url: "http://a/IVL-TS",
            base: "http://a/IVL-TS",
        });
        expect(patch(pkg, { resourceType: "ValueSet", url: "http://b" } as never, noReport)).toBeUndefined();
    });

    test("ensureCodes appends missing concepts, never touches existing ones", () => {
        const patch = ensureCodes("http://cs", ["a", "b"]);
        const cs = { resourceType: "CodeSystem", url: "http://cs", concept: [{ code: "a", display: "A" }] };

        const patched = patch(pkg, cs as never, noReport) as unknown as {
            concept: { code: string; display?: string }[];
        };
        expect(patched.concept).toEqual([{ code: "a", display: "A" }, { code: "b" }]);

        expect(
            patch(pkg, { resourceType: "CodeSystem", url: "http://other", concept: [] } as never, noReport),
        ).toBeUndefined();
    });

    test("inPackage scopes handlers and nests with inResource", () => {
        const patch = inPackage("p", [inResource("http://a", [replaceText("x", "y")])]);

        const hit = patch(pkg, { resourceType: "Basic", url: "http://a", note: "x" } as never, noReport);
        expect((hit as unknown as { note: string }).note).toBe("y");

        expect(
            patch(
                { name: "other", version: "1" },
                { resourceType: "Basic", url: "http://a", note: "x" } as never,
                noReport,
            ),
        ).toBeUndefined();
        expect(patch(pkg, { resourceType: "Basic", url: "http://b", note: "x" } as never, noReport)).toBeUndefined();
    });
});
