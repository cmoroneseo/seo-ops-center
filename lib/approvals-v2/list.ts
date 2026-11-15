export const groups = ['ready_to_send', 'waiting', 'changes_requested', 'approved'] as const;
export type Group = typeof groups[number];
export type LinkState = 'none' | 'active' | 'expiring' | 'expired' | 'revoked';
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface ApprovalRow {
  id: string;
  title: string;
  client: {
    id: string;
    name: string;
  };
  itemType: string;
  pageKinds: string[];
  itemCount: number;
  group: Group;
  linkState: LinkState;
  linkExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner: {
    id: string;
    name: string;
  } | null;
  createdVia: string;
  botName: string | null;
  archivedAt: string | null;
  approvedAt?: string | null;
}
export function approvalGroup(stage: string, items: {
  status: string;
}[]): Group {
  if (stage === 'draft') return 'ready_to_send';
  if (items.some(item => item.status === 'changes_requested')) return 'changes_requested';
  return items.length && items.every(item => item.status === 'approved') ? 'approved' : 'waiting';
}
export function linkState(link: {
  expires_at: string;
  revoked_at: string | null;
} | null, now = Date.now()): LinkState {
  if (!link) return 'none';
  if (link.revoked_at) return 'revoked';
  const remaining = Date.parse(link.expires_at) - now;
  return remaining <= 0 ? 'expired' : remaining <= 3 * 86400000 ? 'expiring' : 'active';
}

/** PostgREST returns unique reverse FKs as objects, older caches may return arrays. */
export function embeddedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}
export function parseListQuery(params: URLSearchParams) {
  const get = (key: string) => params.get(key) || '';
  const value = {
    client: get('client'),
    type: get('type'),
    status: get('status'),
    owner: get('owner'),
    archived: get('archived') || 'false',
    q: get('q').trim(),
    sort: get('sort') || 'oldest',
    cursor: get('cursor')
  };
  if (
    (value.client && !uuid.test(value.client)) ||
    (value.type && !['gbp_post', 'page', 'blog', 'service', 'city'].includes(value.type)) ||
    (value.status && !groups.includes(value.status as Group)) ||
    (value.owner && !['me', 'bot'].includes(value.owner) && !uuid.test(value.owner)) ||
    !['true', 'false'].includes(value.archived) ||
    !['updated', 'created', 'oldest', 'title'].includes(value.sort) ||
    value.q.length > 200
  ) {
    throw new Error('Invalid filters.');
  }
  if (value.cursor) decodeCursor(value.cursor);
  return value;
}
function decodeCursor(encoded: string) {
  if (encoded.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Invalid cursor.');
  const cursor = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as {
    key: string;
    id: string;
  } | null;
  if (!cursor || typeof cursor.key !== 'string' || cursor.key.length > 200 || typeof cursor.id !== 'string' || !uuid.test(cursor.id)) {
    throw new Error('Invalid cursor.');
  }
  return cursor;
}
export function summarizeRows(rows: ApprovalRow[], filters: ReturnType<typeof parseListQuery>, actor: string, pageSize = 50) {
  const badgeCount = rows.filter(row => !row.archivedAt && ['ready_to_send', 'changes_requested'].includes(row.group)).length;
  const filtered = rows.filter(row =>
    (filters.archived === 'true' || !row.archivedAt) &&
    (!filters.client || row.client.id === filters.client) &&
    (!filters.type || row.itemType === filters.type || row.pageKinds.includes(filters.type)) &&
    (!filters.owner || (filters.owner === 'bot'
      ? row.createdVia === 'bot'
      : row.owner?.id === (filters.owner === 'me' ? actor : filters.owner))) &&
    (!filters.q || `${row.title} ${row.client.name}`.toLowerCase().includes(filters.q.toLowerCase()))
  );
  const counts = Object.fromEntries(groups.map(group => [group, filtered.filter(row => row.group === group).length]));
  const key = (row: ApprovalRow) => filters.sort === 'title' ? row.title : filters.sort === 'updated' ? row.updatedAt : row.createdAt;
  const direction = ['title', 'oldest'].includes(filters.sort) ? 1 : -1;
  // Use the same comparator for sorting and seeking, including equal timestamps.
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  let sorted = filtered.filter(row => !filters.status || row.group === filters.status).sort((a, b) => direction * (compare(key(a), key(b)) || compare(a.id, b.id)));
  if (filters.cursor) {
    const cursor = decodeCursor(filters.cursor);
    sorted = sorted.filter(row => direction * (compare(key(row), cursor.key) || compare(row.id, cursor.id)) > 0);
  }
  const page = sorted.slice(0, pageSize);
  const last = page.at(-1);
  return {
    rows: page,
    counts,
    summaryCounts: {
      ...counts,
      approved: filtered.filter(row => row.group === 'approved' && row.approvedAt && Date.parse(row.approvedAt) >= Date.now() - 30 * 86400000).length
    },
    badgeCount,
    nextCursor: sorted.length > pageSize && last ? Buffer.from(JSON.stringify({
      key: key(last),
      id: last.id
    })).toString('base64url') : null,
    clients: [...new Map(rows.map(row => [row.client.id, row.client])).values()],
    owners: [...new Map(rows.filter(row => row.owner).map(row => [row.owner!.id, row.owner!])).values()]
  };
}
export function typeLabel(row: Pick<ApprovalRow, 'itemType' | 'pageKinds'>) {
  if (row.itemType === 'gbp_post') return 'GBP posts';
  return row.pageKinds.length !== 1 ? 'Pages' : {
    blog: 'Blog',
    service: 'Service page',
    city: 'City page'
  }[row.pageKinds[0]] ?? 'Pages';
}
