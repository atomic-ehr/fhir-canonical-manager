import type { HostMethods, WorkerMethods } from "../protocol.js";
import { createRpc, type Endpoint } from "../rpc.js";
import { preparePackages } from "./prepare.js";

let prepared: Omit<Awaited<ReturnType<typeof preparePackages>>, "snapshot"> | undefined;
let started = false;
const rpc = createRpc<HostMethods, WorkerMethods>(globalThis as unknown as Endpoint, {
    async prepare(options) {
        if (started) throw new Error("FHIR Worker has already started preparation");
        started = true;
        const { snapshot, ...owner } = await preparePackages(options, rpc);
        prepared = owner;
        return snapshot;
    },
    async commit() {
        if (!prepared) throw new Error("FHIR Worker has not prepared an installation");
        await prepared.commit();
    },
    async read({ scope, filename, id }) {
        if (!prepared) throw new Error("FHIR Worker has not prepared an installation");
        return prepared.read(scope, filename, id);
    },
});
postMessage({ type: "ready" });
