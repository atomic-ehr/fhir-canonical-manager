import { openDB } from "idb";

/** Stores raw verified archives and packuments; indexes and patches stay per instance. */
export interface Cache {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    putMany?(entries: [string, unknown][], signal?: AbortSignal): Promise<void>;
    clear(prefix: string): Promise<void>;
}

export function createMemoryCache(): Cache {
    const values = new Map<string, unknown>();
    return {
        async get<T>(key: string) {
            return structuredClone(values.get(key)) as T | undefined;
        },
        async put(key, value) {
            values.set(key, structuredClone(value));
        },
        async putMany(entries, signal) {
            const copies = entries.map(([key, value]) => [key, structuredClone(value)] as const);
            signal?.throwIfAborted();
            for (const [key, value] of copies) values.set(key, value);
        },
        async clear(prefix) {
            for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key);
        },
    };
}

export async function createIndexedDbCache(databaseName = "fcm-packages"): Promise<Cache & { close(): void }> {
    const db = await openDB(databaseName, 1, {
        upgrade(database) {
            database.createObjectStore("packages");
        },
    });
    return {
        async get<T>(key: string) {
            return (await db.get("packages", key)) as T | undefined;
        },
        async put(key, value) {
            await db.put("packages", value, key);
        },
        async putMany(entries, signal) {
            signal?.throwIfAborted();
            const tx = db.transaction("packages", "readwrite");
            const abort = () => {
                try {
                    tx.abort();
                } catch {
                    /* Transaction already completed. */
                }
            };
            signal?.addEventListener("abort", abort, { once: true });
            try {
                await Promise.all(entries.map(([key, value]) => tx.store.put(value, key)));
                await tx.done;
            } catch (error) {
                abort();
                await tx.done.catch(() => undefined);
                throw error;
            } finally {
                signal?.removeEventListener("abort", abort);
            }
        },
        async clear(prefix) {
            const tx = db.transaction("packages", "readwrite");
            let cursor = await tx.store.openCursor();
            while (cursor) {
                if (String(cursor.key).startsWith(prefix)) await cursor.delete();
                cursor = await cursor.continue();
            }
            await tx.done;
        },
        close: () => db.close(),
    };
}
