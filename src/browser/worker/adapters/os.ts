import constants from "constants-browserify";
export default {
    homedir: () => "/work/home",
    tmpdir: () => "/work/tmp",
    platform: () => "browser",
    arch: () => "unknown",
    type: () => "Browser Worker",
    release: () => "0",
    cpus: () => [],
    availableParallelism: () => 1,
    endianness: () => "LE",
    EOL: "\n",
    constants: { errno: constants, signals: constants },
};
