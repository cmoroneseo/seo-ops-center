/** Migration 057 remains readable, but accepts no new writes. */
export async function frozenApprovalWrite() {
    return Response.json({ error: 'This approval portal is read-only.', code: 'frozen' }, { status: 410 });
}
export async function frozenDocDrift() {
    return Response.json({ skipped: 'frozen' });
}
