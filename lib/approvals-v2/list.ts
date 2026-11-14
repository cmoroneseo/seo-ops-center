export const groups = ['ready_to_send', 'waiting', 'changes_requested', 'approved'] as const;
export type Group = typeof groups[number];
export type LinkState = 'none' | 'active' | 'expiring' | 'expired' | 'revoked';
export function approvalGroup(stage: string, items: { status: string }[]): Group {
    if (stage === 'draft') return 'ready_to_send';
    if (items.some(i => i.status === 'changes_requested')) return 'changes_requested';
    return items.length && items.every(i => i.status === 'approved') ? 'approved' : 'waiting';
}
export function linkState(link: { expires_at: string; revoked_at: string | null } | null, now = Date.now()): LinkState {
    if (!link) return 'none';
    if (link.revoked_at) return 'revoked';
    const remaining = Date.parse(link.expires_at) - now;
    return remaining <= 0 ? 'expired' : remaining <= 3 * 86400000 ? 'expiring' : 'active';
}
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseListQuery(params: URLSearchParams) {
    const get = (key: string) => params.get(key) || '';
    const value = { client: get('client'), type: get('type'), status: get('status'), owner: get('owner'), archived: get('archived') || 'false', q: get('q').trim(), sort: get('sort') || 'updated', cursor: get('cursor') };
    if ((value.client && !uuid.test(value.client)) || (value.type && !['gbp_post','page','blog','service','city'].includes(value.type)) || (value.status && !groups.includes(value.status as Group)) || (value.owner && !['me','bot'].includes(value.owner) && !uuid.test(value.owner)) || !['true','false'].includes(value.archived) || !['updated','created','oldest','title'].includes(value.sort) || value.q.length > 200) throw new Error('Invalid filters.');
    if (value.cursor) {
        const cursor = JSON.parse(Buffer.from(value.cursor, 'base64url').toString()) as { key: string; id: string };
        if (typeof cursor.key !== 'string' || !uuid.test(cursor.id)) throw new Error('Invalid cursor.');
    }
    return value;
}
export interface ApprovalRow {
    id: string; title: string; client: { id: string; name: string }; itemType: string; pageKinds: string[]; itemCount: number; group: Group; linkState: LinkState; linkExpiresAt: string | null; createdAt: string; updatedAt: string; owner: { id: string; name: string } | null; createdVia: string; botName: string | null; archivedAt: string | null;
}
export function typeLabel(row: Pick<ApprovalRow,'itemType'|'pageKinds'>) {
    if (row.itemType === 'gbp_post') return 'GBP posts';
    return row.pageKinds.length !== 1 ? 'Pages' : ({ blog: 'Blog', service: 'Service page', city: 'City page' }[row.pageKinds[0]] ?? 'Pages');
}
