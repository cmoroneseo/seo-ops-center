/** Search Console positions for the keyword step. A missing connection contributes none. */

export function gscRowConnected(row: { site_url?: unknown; sync_status?: unknown } | null | undefined): boolean {
    if (!row) return false;
    const property = typeof row.site_url === 'string' ? row.site_url.trim() : '';
    return property.length > 0 && row.sync_status === 'active';
}

export function keywordPositionsPayload(input: {
    connected: boolean;
    queries: readonly { query: string; position: number }[];
}): { connected: boolean; positions: { query: string; position: number }[] } {
    if (!input.connected) return { connected: false, positions: [] };
    const positions: { query: string; position: number }[] = [];
    for (const query of input.queries) {
        const text = query.query.trim();
        if (!text || !Number.isFinite(query.position) || query.position <= 0) continue;
        positions.push({ query: text, position: query.position });
    }
    return { connected: true, positions };
}
