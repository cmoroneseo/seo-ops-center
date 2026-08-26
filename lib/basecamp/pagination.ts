/**
 * Basecamp Link-header pagination, with a cycle guard.
 *
 * Measured 2026-08-25: `GET /projects/{id}/timesheet.json` returns the *same*
 * entries on every page and keeps advertising a `rel="next"` that points back
 * at a URL already fetched. A loop that trusts the header multiplies every
 * entry by its page count — one 4.5h entry read as three.
 *
 * Callers pass the set of URLs already fetched; revisiting one ends paging.
 */
export function nextPageUrl(
    linkHeader: string | null,
    seen: ReadonlySet<string>,
): string | null {
    if (!linkHeader) return null;

    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    if (!match) return null;

    const url = match[1];
    return seen.has(url) ? null : url;
}
