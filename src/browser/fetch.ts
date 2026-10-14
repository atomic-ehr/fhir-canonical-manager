export type Fetch = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
) => ReturnType<typeof fetch>;
