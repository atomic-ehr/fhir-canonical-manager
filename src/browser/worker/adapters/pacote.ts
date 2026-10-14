import pacote from "pacote-original";
import { getServices } from "../context.js";
export default {
    ...pacote,
    async manifest(spec: unknown, options: unknown) {
        const selected = await pacote.manifest(spec, options);
        const hydrated = await getServices().hydrate(selected);
        return {
            ...selected,
            ...hydrated,
            dependencies: hydrated.dependencies,
            optionalDependencies: hydrated.optionalDependencies,
            peerDependencies: hydrated.peerDependencies,
            peerDependenciesMeta: hydrated.peerDependenciesMeta,
            name: selected.name,
            version: selected.version,
            _resolved: selected._resolved,
            _integrity: selected._integrity,
            dist: selected.dist,
        };
    },
};
