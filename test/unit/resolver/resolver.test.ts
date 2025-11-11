import { describe, expect, test } from "bun:test";
import { createCache } from "../../../src/cache";
import { resolveWithContext } from "../../../src/resolver";
import type { IndexEntry, SourceContext } from "../../../src/types";

describe("Resolver Module", () => {
    describe("resolveWithContext", () => {
        const mockResolveEntry = async (url: string, options?: any): Promise<IndexEntry> => {
            if (options?.package === "test.package" && options?.version === "1.0.0") {
                return {
                    id: "context-resolved",
                    url,
                    resourceType: "Patient",
                    indexVersion: 1,
                    package: {
                        name: options.package,
                        version: options.version,
                    },
                };
            }
            throw new Error(`Cannot resolve ${url}`);
        };

        test("should resolve with package context", async () => {
            const cache = createCache();
            const context: SourceContext = {
                package: {
                    name: "test.package",
                    version: "1.0.0",
                },
            };

            const result = await resolveWithContext("http://example.com/Patient", context, cache, mockResolveEntry);

            expect(result).not.toBeNull();
            expect(result?.id).toBe("context-resolved");
            expect(result?.package?.name).toBe("test.package");
        });

        test("should return null when context resolution fails", async () => {
            const cache = createCache();
            const context: SourceContext = {
                package: {
                    name: "unknown.package",
                    version: "1.0.0",
                },
            };

            const result = await resolveWithContext("http://example.com/Patient", context, cache, mockResolveEntry);

            expect(result).toBeNull();
        });

        test("should return null when no package in context", async () => {
            const cache = createCache();
            const context: SourceContext = {
                url: "http://example.com/context",
            };

            const result = await resolveWithContext("http://example.com/Patient", context, cache, mockResolveEntry);

            expect(result).toBeNull();
        });

        test("should handle empty context", async () => {
            const cache = createCache();
            const context: SourceContext = {};

            const result = await resolveWithContext("http://example.com/Patient", context, cache, mockResolveEntry);

            expect(result).toBeNull();
        });

        test("should pass correct options to resolveEntry", async () => {
            const cache = createCache();
            const context: SourceContext = {
                package: {
                    name: "my.package",
                    version: "2.0.0",
                },
            };

            let capturedOptions: any;
            const capturingResolveEntry = async (_url: string, options?: any): Promise<IndexEntry> => {
                capturedOptions = options;
                throw new Error("Expected error");
            };

            await resolveWithContext("http://example.com/Resource", context, cache, capturingResolveEntry);

            expect(capturedOptions).toEqual({
                package: "my.package",
                version: "2.0.0",
            });
        });
    });
});
