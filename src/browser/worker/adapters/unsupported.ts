const denied = (): never => {
    throw new Error("Unsupported Node runtime API in the browser package worker");
};
class Agent {
    constructor() {
        denied();
    }
}
export default {
    Agent,
    globalAgent: {},
    spawn: denied,
    spawnSync: denied,
    exec: denied,
    execFile: denied,
    execSync: denied,
    connect: denied,
    request: denied,
    get: denied,
    createConnection: denied,
    lookup: denied,
    resolve: denied,
    constants: {},
    isIP: () => 0,
};
