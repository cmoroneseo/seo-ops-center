import test from 'node:test';
import assert from 'node:assert/strict';

import {
    approvedMonthsSummary,
    buildReviewEvidence,
    coveringPage,
    duplicateWarning,
    evidenceFor,
    factsFromRows,
    groupReviewRows,
    groupSummary,
    isQuickWin,
    monthOptionNote,
    NO_DATA_REASON,
    overPlanWarning,
    planCardNote,
    priorityBand,
    priorityReason,
    priorityScore,
    reviewCounts,
    reviewPlan,
    reviewRows,
    reviewStatus,
    selectionPreview,
    type QueryEvidence,
    type ReviewEvidence,
    type ReviewIdeaInput,
} from './review.ts';
import type { CannibalFact } from '../keyword-tracking/cannibalization.ts';

function evidence(overrides: Partial<QueryEvidence> = {}): QueryEvidence {
    return {
        query: 'cracked tooth what to do',
        impressions: 420,
        clicks: 6,
        position: 14,
        pages: [],
        competing: false,
        ...overrides,
    };
}

function idea(overrides: Partial<ReviewIdeaInput> = {}): ReviewIdeaInput {
    return {
        id: 'idea-1',
        siloId: 'silo-a',
        title: 'What to do after a cracked tooth',
        targetQuery: 'cracked tooth what to do',
        action: 'create',
        status: 'pending',
        buildPhase: 1,
        sortOrder: 0,
        ...overrides,
    };
}

function fact(overrides: Partial<CannibalFact> = {}): CannibalFact {
    return {
        date: '2026-11-01',
        query: 'cracked tooth what to do',
        page: 'https://example.com/blog/teeth',
        clicks: 1,
        impressions: 100,
        position: 14,
        grain: 'query_page',
        ...overrides,
    };
}

// ─── Scoring ────────────────────────────────────────────────────────────────

test('an idea with no Search Console match has no score, never a guessed number', () => {
    assert.deepEqual(priorityScore({ action: 'create', evidence: null }), { score: null, quickWin: false });
    assert.equal(priorityScore({ action: 'create', evidence: evidence({ impressions: 0 }) }).score, null);
    assert.equal(priorityBand(null), null);
});

test('positions 8 to 20 count as a quick win and score higher than the same demand elsewhere', () => {
    assert.equal(isQuickWin(7.4), false);
    assert.equal(isQuickWin(7.6), true);
    assert.equal(isQuickWin(20.4), true);
    assert.equal(isQuickWin(20.6), false);
    const quick = priorityScore({ action: 'create', evidence: evidence({ position: 14 }) });
    const top = priorityScore({ action: 'create', evidence: evidence({ position: 2 }) });
    const deep = priorityScore({ action: 'create', evidence: evidence({ position: 60 }) });
    assert.equal(quick.quickWin, true);
    assert.equal(top.quickWin, false);
    assert.ok((quick.score ?? 0) > (top.score ?? 0));
    assert.ok((quick.score ?? 0) > (deep.score ?? 0));
});

test('more impressions score higher, on a log scale capped at 100', () => {
    const small = priorityScore({ action: 'create', evidence: evidence({ impressions: 10 }) }).score ?? 0;
    const mid = priorityScore({ action: 'create', evidence: evidence({ impressions: 420 }) }).score ?? 0;
    const big = priorityScore({ action: 'create', evidence: evidence({ impressions: 1_000_000 }) }).score ?? 0;
    assert.ok(small < mid && mid < big);
    assert.equal(mid, 39 + 30);
    assert.ok(big <= 100);
});

test('a new page for a search an existing page already covers loses points; an improve idea gains', () => {
    const covered = evidence({ pages: [{ url: 'https://example.com/x', impressions: 400, position: 3 }] });
    const create = priorityScore({ action: 'create', evidence: evidence() }).score ?? 0;
    const duplicate = priorityScore({ action: 'create', evidence: covered }).score ?? 0;
    const improve = priorityScore({ action: 'improve', evidence: evidence(), matchedUrl: 'https://example.com/x' }).score ?? 0;
    assert.equal(create - duplicate, 25);
    assert.equal(improve - create, 10);
});

test('a page sitting at a quick-win spot does not count as already covering the search', () => {
    const onPageTwo = evidence({ pages: [{ url: 'https://example.com/blog', impressions: 400, position: 14 }] });
    assert.equal(coveringPage({ evidence: onPageTwo }), null);
    assert.equal(coveringPage({ evidence: onPageTwo, matchedUrl: 'https://example.com/x' }), 'https://example.com/x');
    const onPageOne = evidence({ pages: [{ url: 'https://example.com/blog', impressions: 400, position: 5 }] });
    assert.equal(coveringPage({ evidence: onPageOne }), 'https://example.com/blog');
});

// ─── Reason text ────────────────────────────────────────────────────────────

test('the reason reads like the example: searches a month and where it sits', () => {
    assert.equal(
        priorityReason(evidence({ impressions: 420, position: 14 }), 28),
        'Already shows up in 420 Google searches a month, sitting on page 2: a quick win',
    );
    assert.equal(
        priorityReason(evidence({ impressions: 1300, position: 9 }), 28),
        'Already shows up in 1,300 Google searches a month, at the bottom of page 1: a quick win',
    );
    assert.equal(
        priorityReason(evidence({ impressions: 80, position: 2.2 }), 28),
        'Already shows up in 80 Google searches a month, already near the top of page 1',
    );
    assert.equal(
        priorityReason(evidence({ impressions: 1, position: 45 }), 28),
        'Already shows up in 1 Google search a month, past page 3',
    );
});

test('a short stored window says how many days instead of claiming a month', () => {
    assert.equal(
        priorityReason(evidence({ impressions: 50, position: 25 }), 9),
        'Already shows up in 50 Google searches in the last 9 days, on page 3',
    );
    assert.equal(priorityReason(evidence({ position: null }), 28), 'Already shows up in 420 Google searches a month');
});

test('no Search Console match says so in plain English', () => {
    assert.equal(priorityReason(null, 28), 'New topic, no Google data yet');
    assert.equal(NO_DATA_REASON, 'New topic, no Google data yet');
});

// ─── Duplicate-page warning ─────────────────────────────────────────────────

test('warns when the map already matched an existing page to a new idea', () => {
    assert.equal(
        duplicateWarning(idea({ matchedUrl: 'https://example.com/emergency-dentist/' }), null),
        'Your page /emergency-dentist/ already covers this. Approving may create two pages competing for the same search.',
    );
});

test('warns when Google already shows one of your pages on page 1 for the search', () => {
    const shown = evidence({ pages: [{ url: 'https://example.com/x', impressions: 300, position: 4 }] });
    assert.equal(
        duplicateWarning(idea(), shown),
        'Your page /x already covers this. Approving may create two pages competing for the same search.',
    );
});

test('warns when two of your pages already compete in Google for the search', () => {
    const competing = evidence({
        competing: true,
        pages: [
            { url: 'https://example.com/a', impressions: 300, position: 12 },
            { url: 'https://example.com/b', impressions: 100, position: 30 },
        ],
    });
    assert.match(duplicateWarning(idea(), competing) ?? '', /Google already shows 2 of your pages for this search, \/a and \/b/);
});

test('warns when another idea in the map targets the same search, but not a declined one', () => {
    const twin = idea({ id: 'idea-2', title: 'Cracked tooth guide', targetQuery: '  Cracked  tooth what to do ' });
    assert.match(duplicateWarning(idea(), null, [idea(), twin]) ?? '', /Another idea, “Cracked tooth guide”, already targets this search/);
    assert.equal(duplicateWarning(idea(), null, [idea(), { ...twin, status: 'declined' }]), null);
});

test('improve and replace ideas work on the existing page on purpose, so they get no warning', () => {
    assert.equal(duplicateWarning(idea({ action: 'improve', matchedUrl: 'https://example.com/x' }), null), null);
    assert.equal(duplicateWarning(idea({ action: 'replace', matchedUrl: 'https://example.com/x' }), null), null);
    assert.equal(duplicateWarning(idea(), evidence({ pages: [{ url: 'https://example.com/blog', impressions: 5, position: 15 }] })), null);
});

// ─── Evidence from gsc_history_facts ────────────────────────────────────────

test('evidence keeps only searches the map targets, weights position by impressions, and flags competing pages', () => {
    const facts = [
        fact({ impressions: 300, position: 10, page: 'https://example.com/a' }),
        fact({ date: '2026-11-02', impressions: 100, position: 20, page: 'https://example.com/b#top' }),
        fact({ query: 'Something Else', impressions: 9000 }),
        fact({ query: 'Knocked Out Tooth', impressions: 50, position: 8, page: 'https://example.com/a' }),
    ];
    const built = buildReviewEvidence({
        targetQueries: ['cracked tooth what to do', 'knocked out tooth', 'no data search'],
        facts,
        days: 28,
        connected: true,
    });
    assert.equal(built.connected, true);
    assert.equal(built.queries.length, 2);
    const cracked = evidenceFor(built, 'Cracked Tooth What To Do');
    assert.ok(cracked);
    assert.equal(cracked.impressions, 400);
    assert.equal(cracked.position, (300 * 10 + 100 * 20) / 400);
    assert.deepEqual(cracked.pages.map(page => page.url), ['https://example.com/a', 'https://example.com/b']);
    assert.equal(cracked.competing, true);
    assert.equal(evidenceFor(built, 'knocked out tooth')?.competing, false);
    assert.equal(evidenceFor(built, 'no data search'), null);
});

test('no connection means no evidence, never invented numbers', () => {
    const built = buildReviewEvidence({ targetQueries: ['cracked tooth what to do'], facts: [fact()], days: 28, connected: false });
    assert.deepEqual(built, { connected: false, days: 0, queries: [] });
});

test('raw fact rows get their date from the stored day', () => {
    const rows = [
        { day_id: 'd1', query: 'cracked tooth what to do', page: 'https://example.com/a', clicks: 1, impressions: '12', position: 9 },
        { day_id: 'missing', query: 'x', page: 'https://example.com/a', clicks: 1, impressions: 1, position: 1 },
    ];
    const facts = factsFromRows(rows, new Map([['d1', '2026-11-03']]));
    assert.equal(facts.length, 1);
    assert.equal(facts[0].date, '2026-11-03');
    assert.equal(facts[0].impressions, 12);
});

// ─── Rows, sorting and groups ───────────────────────────────────────────────

const silos = [
    { id: 'silo-a', name: 'Emergency care', sortOrder: 0 },
    { id: 'silo-b', name: 'Dental implants', sortOrder: 1 },
];

function sampleEvidence(): ReviewEvidence {
    return {
        connected: true,
        days: 28,
        queries: [
            evidence({ query: 'quick', impressions: 400, position: 12 }),
            evidence({ query: 'big', impressions: 5000, position: 3 }),
            evidence({ query: 'implants', impressions: 3000, position: 15 }),
        ],
    };
}

function sampleIdeas(): ReviewIdeaInput[] {
    return [
        idea({ id: 'main-a', targetQuery: 'nothing', sortOrder: 0 }),
        idea({ id: 'quick', parentRecordId: 'main-a', targetQuery: 'quick', sortOrder: 1 }),
        idea({ id: 'big', parentRecordId: 'main-a', targetQuery: 'big', sortOrder: 2 }),
        idea({ id: 'implants', siloId: 'silo-b', targetQuery: 'implants', sortOrder: 0 }),
        idea({ id: 'live', siloId: 'silo-b', targetQuery: 'live', action: 'keep', matchedUrl: 'https://example.com/live', sortOrder: 1 }),
    ];
}

test('priority sort puts the highest score first, ideas without data last, and the best group first', () => {
    const rows = reviewRows(sampleIdeas(), sampleEvidence());
    const groups = groupReviewRows(rows, silos, 'priority');
    assert.deepEqual(groups.map(group => group.name), ['Dental implants', 'Emergency care']);
    assert.deepEqual(groups[1].rows.map(row => row.idea.id), ['quick', 'big', 'main-a']);
    assert.equal(groups[1].rows[2].reason, 'New topic, no Google data yet');
    assert.equal(groups[1].rows[2].score, null);
});

test('map order keeps each main topic page above its supporting articles', () => {
    const rows = reviewRows(sampleIdeas(), sampleEvidence());
    const groups = groupReviewRows(rows, silos, 'map');
    assert.deepEqual(groups.map(group => group.name), ['Emergency care', 'Dental implants']);
    assert.deepEqual(groups[0].rows.map(row => row.idea.id), ['main-a', 'quick', 'big']);
    assert.equal(groups[0].rows[0].main, true);
    assert.equal(groups[0].rows[1].main, false);
});

test('statuses, counts and group summaries', () => {
    assert.equal(reviewStatus({ status: 'pending', action: 'keep', matchedUrl: 'https://example.com/x' }), 'live');
    assert.equal(reviewStatus({ status: 'approved', action: 'create' }), 'approved');
    assert.equal(reviewStatus({ status: 'declined', action: 'create', productionStatus: 'declined' }), 'declined');
    assert.equal(reviewStatus({ status: 'pending', action: 'create' }), 'waiting');
    const rows = reviewRows(sampleIdeas(), sampleEvidence());
    assert.deepEqual(reviewCounts(rows), { all: 5, waiting: 4, approved: 0, declined: 0, live: 1 });
    const implants = rows.filter(row => row.idea.siloId === 'silo-b');
    assert.equal(groupSummary(implants, new Set(['implants'])), '2 ideas · 1 of 1 waiting selected · 1 already live');
    assert.equal(rows.find(row => row.idea.id === 'live')?.warning, null);
});

// ─── Monthly plan preview (warns, never blocks) ─────────────────────────────

function planned(id: string, workMonth: string) {
    return { id, status: 'approved', productionStatus: 'approved' as const, action: 'create' as const, workMonth };
}

test('approving the selection over the plan warns with the mockup copy', () => {
    const records = [...Array.from({ length: 6 }, (_, index) => planned(`p${index}`, '2026-11')), planned('dec', '2026-12')];
    const plan = reviewPlan(records, ['a', 'b', 'c', 'd', 'e', 'f'], 8, '2026-11');
    assert.deepEqual(plan, { month: '2026-11', planned: 6, selected: 6, after: 12, limit: 8, over: 4 });
    assert.equal(overPlanWarning(plan), "Approving the 6 selected would make November 12 of 8: 4 over this month's plan");
    assert.equal(selectionPreview(plan), 'November would be 4 over plan');
    assert.equal(monthOptionNote(plan), 'Would be 4 over plan');
    assert.equal(monthOptionNote(reviewPlan(records, ['a', 'b', 'c', 'd', 'e', 'f'], 8, '2026-12')), 'Would be 7 of 8: fits');
    assert.equal(planCardNote(plan), '4 over plan if you approve the 6 selected for November. Approving is never blocked.');
});

test('within the plan there is no warning, and no saved plan means nothing to compare', () => {
    const records = Array.from({ length: 6 }, (_, index) => planned(`p${index}`, '2026-11'));
    const fits = reviewPlan(records, ['a', 'b'], 8, '2026-11');
    assert.equal(overPlanWarning(fits), null);
    assert.equal(selectionPreview(fits), 'November would be 8 of 8');
    assert.equal(planCardNote(fits), 'Approving the 2 selected would make it 8 of 8. The plan would be full.');
    const none = reviewPlan(records, ['a'], null, '2026-11');
    assert.equal(none.limit, null);
    assert.equal(overPlanWarning(none), null);
});

test('done summary lists approved pieces by month', () => {
    const records = [planned('a', '2026-11'), planned('b', '2026-11'), planned('c', '2026-12'), { id: 'd', status: 'declined', action: 'create' as const }];
    assert.equal(approvedMonthsSummary(records), '2 for November and 1 for December');
});
