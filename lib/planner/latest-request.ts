/**
 * Marks asynchronous reloads so a slower, older response cannot overwrite a
 * newer authoritative result.
 */
export function createLatestRequestGate(): { start: () => () => boolean } {
    let latestRequest = 0;

    return {
        start() {
            const request = ++latestRequest;
            return () => request === latestRequest;
        },
    };
}
