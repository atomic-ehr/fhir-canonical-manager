/**
 * Search parameters command - displays search parameters for a resource type
 */

import { CanonicalManager } from "../index.js";
import type { SearchParameter } from "../types/index.js";
import { getConfigFromPackageJson, loadPackageJson, parseArgs } from "./index.js";

export async function searchParamCommand(args: string[]): Promise<void> {
    const { positional, options } = parseArgs(args);

    if (options.help || positional.length === 0) {
        console.log(`
Usage: fcm searchparam <resourceType> [options]

Display search parameters for a specific FHIR resource type

Arguments:
  resourceType    The FHIR resource type (e.g., Patient, Observation)

Options:
  --format        Output format: table (default), json, csv
  --help          Show this help message

Examples:
  fcm searchparam Patient
  fcm searchparam Observation --format json
  fcm searchparam Encounter --format csv
`);
        return;
    }

    const resourceType = positional[0];
    const format = (options.format as string) || "table";

    // Load config from package.json
    const packageJson = await loadPackageJson();
    if (!packageJson) {
        throw new Error("No package.json found. Run 'fcm init' to initialize a project.");
    }

    const config = getConfigFromPackageJson(packageJson);
    const manager = CanonicalManager({
        packages: config.packages || [],
        registry: config.registry,
        workingDir: config.workingDir || process.cwd(),
    });

    await manager.init();

    try {
        const searchParams = await manager.getSearchParametersForResource(resourceType!);

        if (searchParams.length === 0) {
            console.log(`No search parameters found for resource type '${resourceType}'`);
            return;
        }

        // Format output based on requested format
        switch (format) {
            case "json":
                outputJson(searchParams);
                break;
            case "csv":
                outputCsv(searchParams);
                break;
            default:
                outputTable(searchParams);
                break;
        }
    } finally {
        await manager.destroy();
    }
}

function outputTable(searchParams: SearchParameter[]): void {
    console.log("");

    // Display each parameter as a multiline block
    for (const param of searchParams) {
        const code = param.code || "";
        const type = param.type || "";
        const expression = param.expression || "";
        const url = param.url || "";

        console.log(`Code:       ${code}`);
        console.log(`Type:       ${type}`);
        if (expression) {
            // Wrap long expressions
            if (expression.length > 60) {
                console.log(`Expression: ${wrapText(expression, 60, "            ")}`);
            } else {
                console.log(`Expression: ${expression}`);
            }
        } else {
            console.log(`Expression: (none)`);
        }
        console.log(`URL:        ${url}`);
        console.log("---");
    }

    console.log(`Total: ${searchParams.length} search parameters`);
}

// Helper function to wrap text at specified width
function wrapText(text: string, width: number, indent: string): string {
    const words = text.split(" ");
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
        if (currentLine.length + word.length + 1 <= width) {
            currentLine += (currentLine ? " " : "") + word;
        } else {
            if (currentLine) {
                lines.push(currentLine);
            }
            currentLine = word;
        }
    }

    if (currentLine) {
        lines.push(currentLine);
    }

    return lines.join(`\n${indent}`);
}

function outputJson(searchParams: SearchParameter[]): void {
    const output = searchParams.map((param) => ({
        code: param.code,
        type: param.type,
        expression: param.expression || null,
        url: param.url,
    }));
    console.log(JSON.stringify(output, null, 2));
}

function outputCsv(searchParams: SearchParameter[]): void {
    // CSV header
    console.log("Code,Type,Expression,URL");

    // CSV rows - no truncation for CSV output
    for (const param of searchParams) {
        const code = escapeCsv(param.code || "");
        const type = escapeCsv(param.type || "");
        const expression = escapeCsv(param.expression || "");
        const url = escapeCsv(param.url || "");
        console.log(`${code},${type},${expression},${url}`);
    }
}

function escapeCsv(value: string): string {
    // Escape CSV values that contain commas, quotes, or newlines
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}
