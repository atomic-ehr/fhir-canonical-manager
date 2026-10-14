import { createFsFromVolume, Volume } from "memfs";
import { serializeError } from "../protocol.js";
import { setFilesystem } from "./context.js";

setFilesystem(createFsFromVolume(new Volume()));
void import("./entry.js").catch((error) => postMessage({ type: "fatal", error: serializeError(error) }));
