import {
    createCanonicalManager,
    createIndexedDbCache,
    createMemoryCache,
} from "@atomic-ehr/fhir-canonical-manager/browser";
import { excludeCanonical } from "@atomic-ehr/fhir-canonical-manager/patch";

export const api = { createCanonicalManager, createIndexedDbCache, createMemoryCache, excludeCanonical };
Object.assign(globalThis, { fcm: api });
