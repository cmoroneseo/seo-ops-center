/**
 * Does what SEO PM holds actually agree with Basecamp?
 *
 * The import fingerprints every row on the way in, so the two sides are
 * comparable — but nothing ever compared them. That gap is not theoretical:
 * two of Abel's August entries were reported as deleted from Basecamp when
 * they were sitting in the CSV the whole time. The claim came from an endpoint
 * that silently returns only the newest 25 entries, and nothing existed to
 * contradict it.
 *
 * This reconciles by fingerprint and reports three populations: matched, only
 * at the provider, only here. A reviewer approving hours onto a client's budget
 * can then see the import is COMPLETE, rather than merely plausible.
 *
 * Pure: no Supabase, no Basecamp, no React.
 */

export interface ProviderEntry {
    fingerprint: string;
    date: string;
    hours: number;
    projectName: string;
    person: string;
    /** Free text from the provider, for recognizing a row on sight. */
    notes?: string;
}

export interface LocalEntry {
    id: string;
    /** Null for time authored here, which therefore can never match. */
    fingerprint: string | null;
    date: string;
    hours: number;
    clientName: string | null;
    description: string | null;
    importStatus: string | null;
}

export interface Reconciliation {
    matched: Array<{ provider: ProviderEntry; local: LocalEntry }>;
    /** In Basecamp, absent here — the import missed it. */
    providerOnly: ProviderEntry[];
    /** Here, absent from Basecamp — deleted there, or never came from there. */
    localOnly: LocalEntry[];
    providerHours: number;
    localHours: number;
    matchedHours: number;
    /** True when every row on both sides is accounted for. */
    balanced: boolean;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function sumHours(rows: Array<{ hours: number }>): number {
    return round2(rows.reduce((total, row) => total + row.hours, 0));
}

/**
 * Compare the two sides by fingerprint.
 *
 * A fingerprint is consumed once. Basecamp's own unique index makes duplicates
 * impossible in practice, but pairing greedily rather than grouping means a
 * repeat can only ever produce an extra unmatched row — never a silent
 * over-count that would make the totals look balanced when they are not.
 */
export function reconcileTimesheet(
    providerRows: ProviderEntry[],
    localRows: LocalEntry[],
): Reconciliation {
    const remaining = new Map<string, LocalEntry[]>();
    for (const local of localRows) {
        if (!local.fingerprint) continue;
        const bucket = remaining.get(local.fingerprint);
        if (bucket) bucket.push(local);
        else remaining.set(local.fingerprint, [local]);
    }

    const matched: Reconciliation['matched'] = [];
    const providerOnly: ProviderEntry[] = [];
    const pairedLocalIds = new Set<string>();

    for (const provider of providerRows) {
        const bucket = remaining.get(provider.fingerprint);
        const local = bucket?.shift();
        if (local) {
            matched.push({ provider, local });
            pairedLocalIds.add(local.id);
        } else {
            providerOnly.push(provider);
        }
    }

    const localOnly = localRows.filter(local => !pairedLocalIds.has(local.id));

    return {
        matched,
        providerOnly,
        localOnly,
        providerHours: sumHours(providerRows),
        localHours: sumHours(localRows),
        matchedHours: sumHours(matched.map(pair => pair.provider)),
        balanced: providerOnly.length === 0 && localOnly.length === 0,
    };
}
