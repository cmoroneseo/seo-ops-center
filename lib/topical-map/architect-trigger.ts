/**
 * Starts the paid architect stage at most once per map while a request is in
 * flight. The guard lives at module level, so a remounted progress card (tab
 * switch, React Strict Mode) or a second poll cannot start another run.
 *
 * Only a definite failure response from the route releases the guard so a
 * later poll can retry. A network error does not: the server may still be
 * running the first request.
 */

const inFlight = new Set<string>();

export type ArchitectFetch = (input: string, init: RequestInit) => Promise<Response>;

/** Returns false when a run for this map is already in flight. */
export function triggerArchitectOnce(mapId: string, fetchImpl: ArchitectFetch = (input, init) => fetch(input, init)): boolean {
    if (inFlight.has(mapId)) return false;
    inFlight.add(mapId);
    void fetchImpl('/api/topical-map/generate-architect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapId }),
    }).then(async (res) => {
        if (res.ok) return;
        const body = await res.json().catch(() => ({}));
        console.error('Architect failed:', res.status, body?.error ?? body);
        // 409 means the stage already finished; keep the guard so it is never re-sent.
        if (res.status !== 409) inFlight.delete(mapId);
    }).catch(() => {
        // Network error: the first request may still be running on the server.
    });
    return true;
}

/** Test-only reset. */
export function resetArchitectTriggerForTests(): void {
    inFlight.clear();
}
