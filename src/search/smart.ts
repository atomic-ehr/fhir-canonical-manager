/**
 * Smart search functionality with abbreviation support
 */

import type { IndexEntry, PackageId } from "../types/index.js";
import { expandedTerms } from "./terms.js";

export interface SmartSearchFilters {
    resourceType?: string;
    type?: string;
    kind?: string;
    package?: PackageId;
}

export const filterBySmartSearch = (results: IndexEntry[], searchTerms: string[]): IndexEntry[] => {
    if (searchTerms.length === 0) {
        return results;
    }

    const terms = searchTerms.map((t) => t.toLowerCase());

    return results.filter((entry) => {
        if (!entry.url) return false;
        const urlLower = entry.url.toLowerCase();

        // Also check type and resourceType for matching
        const fullText = [urlLower, entry.type?.toLowerCase() || "", entry.resourceType?.toLowerCase() || ""].join(" ");

        // Check if all search terms match
        return terms.every((term) => {
            // Split the text into parts (by /, -, _, ., spaces)
            const allParts = fullText.split(/[\/\-_\.\s]+/);

            // Check if any part starts with the search term
            const directMatch = allParts.some((part) => part.startsWith(term));
            if (directMatch) return true;

            // Check if the term is an abbreviation
            const expansions = expandedTerms[term] || [];
            for (const expansion of expansions) {
                if (allParts.some((part) => part.startsWith(expansion))) {
                    return true;
                }
            }

            // If still no match, check if the term appears anywhere (substring match)
            return fullText.includes(term);
        });
    });
};
