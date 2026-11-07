import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    addIsoDays,
    completedDeliveries,
    EVIDENCE_FRESH_DAYS,
    evidenceFreshness,
    initiativeRow,
    initiativeWriteScope,
    measurementStrip,
    nextMilestone,
    normalizeInitiativeDraft,
    statePresentation,
    timelineModel,
    verificationTone,
    type CampaignInitiative,
    type InitiativeDraft,
} from './initiatives.ts';

const TODAY = '2026-11-07';

function initiative(partial: Partial<CampaignInitiative> & Pick<CampaignInitiative, 'id' | 'title' | 'state'>): CampaignInitiative {
    return {
        organizationId: 'org-harbor',
        clientId: 'client-harbor',
        purpose: null,
        ownerName: 'Alex Kim',
        priority: 2,
        startsOn: null,
        endsOn: null,
        pageUrl: null,
        successMetricLabel: null,
        evidenceUrl: null,
        verifiedOn: null,
        items: [],
        ...partial,
    };
}

const emergency = initiative({
    id: 'harbor-emergency',
    title: 'Emergency service page',
    purpose: 'Cover the after-hours visit',
    priority: 1,
    state: 'in_progress',
    startsOn: '2026-09-01',
    endsOn: '2026-11-20',
    pageUrl: 'https://harbor.example/services/emergency',
    successMetricLabel: 'Service page clicks',
    items: [{
        id: 'harbor-draft',
        title: 'After-hours draft',
        contentState: 'draft',
        draftUrl: 'https://harbor.example/drafts/after-hours',
        liveUrl: null,
        publishedOn: null,
        position: 0,
    }],
});

const crawl = initiative({
    id: 'harbor-crawl',
    title: 'Crawl access',
    purpose: 'Blocked URLs waste crawl',
    priority: 1,
    state: 'blocked',
});

const profile = initiative({
    id: 'harbor-profile',
    title: 'Profile categories',
    purpose: 'Help patients recognize the practice',
    state: 'completed_verified',
    startsOn: '2026-10-03',
    endsOn: '2026-10-04',
    evidenceUrl: 'https://harbor.example/proof/profile',
    verifiedOn: '2026-10-04',
    items: [{
        id: 'harbor-categories',
        title: 'Category update',
        contentState: 'published',
        draftUrl: null,
        liveUrl: 'https://harbor.example/blog/categories',
        publishedOn: '2026-10-04',
        position: 0,
    }],
});

const citations = initiative({
    id: 'harbor-citations',
    title: 'Citation consistency',
    purpose: 'Keep the practice name consistent',
    state: 'completed_verified',
    startsOn: '2026-08-01',
    endsOn: '2026-08-01',
    evidenceUrl: 'https://harbor.example/proof/citations',
    verifiedOn: '2026-08-01',
});

const unproven = initiative({
    id: 'harbor-unproven',
    title: 'Unproven cleanup',
    state: 'completed_verified',
});

const harbor = [emergency, crawl, profile, citations, unproven];

function draft(partial: Partial<InitiativeDraft> = {}): InitiativeDraft {
    return {
        title: 'Coverage page rewrite',
        purpose: 'Explain what the visit includes',
        ownerName: 'Alex Kim',
        priority: '2',
        state: 'planned',
        startsOn: '',
        endsOn: '',
        pageUrl: '',
        successMetricLabel: '',
        evidenceUrl: '',
        verifiedOn: '',
        items: [],
        ...partial,
    };
}

test('evidence is fresh for 60 days and stale after that', () => {
    assert.equal(EVIDENCE_FRESH_DAYS, 60);
    assert.equal(addIsoDays('2026-09-08', 60), '2026-11-07');
    assert.equal(evidenceFreshness('2026-09-08', TODAY), 'fresh');
    assert.equal(evidenceFreshness('2026-09-07', TODAY), 'stale');
    assert.equal(evidenceFreshness('2026-10-04', TODAY), 'fresh');
    assert.equal(evidenceFreshness('2026-08-01', TODAY), 'stale');
    assert.equal(evidenceFreshness('not-a-date', TODAY), 'stale');
});

test('missing evidence cannot be a verified win', () => {
    assert.equal(verificationTone(unproven, TODAY), 'incomplete');
    assert.equal(statePresentation(unproven, TODAY).tone, 'incomplete');
    assert.equal(statePresentation(unproven, TODAY).label.includes('Completed & Verified'), false);
    assert.equal(verificationTone(citations, TODAY), 'stale');
    assert.match(statePresentation(citations, TODAY).label, /Evidence stale — re-verify/);
    assert.equal(statePresentation(profile, TODAY).tone, 'fresh');
    const deliveries = completedDeliveries(harbor, TODAY);
    assert.deepEqual(deliveries.map(item => item.id), ['harbor-citations', 'harbor-profile']);
    assert.equal(deliveries.some(item => item.id === 'harbor-unproven'), false);
    assert.equal(deliveries.find(item => item.id === 'harbor-citations')?.verification, 'stale');
    assert.equal(deliveries.find(item => item.id === 'harbor-profile')?.url, 'https://harbor.example/blog/categories');
    assert.equal(JSON.stringify(deliveries).includes('clicks'), false);
});

test('a metric label is not a measured number', () => {
    const strip = measurementStrip({ successMetricLabel: '140' });
    assert.equal(strip.status, 'Not yet measurable');
    assert.equal(strip.label, '140');
    assert.equal(strip.value, null);
});

test('the next milestone is the earliest upcoming dated initiative', () => {
    const milestone = nextMilestone(harbor, TODAY);
    assert.equal(milestone?.initiativeId, 'harbor-emergency');
    assert.equal(milestone?.date, '2026-11-20');
    assert.equal(milestone?.items[0]?.stateLabel, 'Draft');
    const past = initiative({
        id: 'past',
        title: 'Past end',
        state: 'in_progress',
        endsOn: '2026-11-01',
        priority: 1,
    });
    const later = initiative({
        id: 'later',
        title: 'Later start',
        state: 'planned',
        startsOn: '2026-12-01',
    });
    assert.equal(nextMilestone([past, later, profile], TODAY)?.initiativeId, 'later');
    assert.equal(nextMilestone([past, profile, crawl], TODAY), null);
});

test('dates that are not set do not get a bar', () => {
    const model = timelineModel(harbor, TODAY);
    const byId = new Map(model.rows.map(row => [row.id, row]));
    assert.equal(byId.get('harbor-crawl')?.datesLabel, 'Dates not set');
    assert.equal(byId.get('harbor-crawl')?.bar, null);
    assert.equal(byId.get('harbor-unproven')?.bar, null);
    assert.equal(byId.get('harbor-emergency')?.bar?.kind, 'span');
    assert.equal(byId.get('harbor-profile')?.bar?.kind, 'span');
    assert.equal(byId.get('harbor-citations')?.bar?.kind, 'point');
    const emergencyBar = byId.get('harbor-emergency')?.bar;
    const profileBar = byId.get('harbor-profile')?.bar;
    const citationBar = byId.get('harbor-citations')?.bar;
    assert.ok(emergencyBar && profileBar && citationBar);
    assert.ok(citationBar.start < profileBar.start);
    assert.ok(profileBar.start < emergencyBar.end);
    assert.deepEqual(model.months.map(month => month.label), ['Aug', 'Sep', 'Oct', 'Nov']);
    assert.equal(model.todayLabel, 'Today · Nov 7');
    assert.equal(timelineModel([crawl], TODAY).months.length, 0);

    const onlyStart = timelineModel([initiative({
        id: 'start-only',
        title: 'Start only',
        state: 'planned',
        startsOn: '2026-10-03',
    })], TODAY);
    assert.equal(onlyStart.rows[0]?.bar?.kind, 'point');
    assert.match(onlyStart.rows[0]?.datesLabel ?? '', /Starts Oct 3, 2026/);
});

test('a range that crosses a year labels the year', () => {
    const model = timelineModel([initiative({
        id: 'year',
        title: 'Year span',
        state: 'planned',
        startsOn: '2026-12-01',
        endsOn: '2027-01-15',
    })], '2026-12-15');
    assert.deepEqual(model.months.map(month => month.label), ['Dec 2026', 'Jan 2027']);
});

test('writes reject a forged organization, missing evidence, and a published row without a live URL', () => {
    const forged = initiativeWriteScope({
        client: { id: 'client-harbor', organizationId: 'org-real' },
        assertedOrganizationId: 'org-forged',
    });
    assert.equal(forged.ok, false);
    const missing = initiativeWriteScope({ client: null, assertedOrganizationId: 'org-forged' });
    assert.equal(missing.ok, false);
    const scoped = initiativeWriteScope({
        client: { id: 'client-harbor', organizationId: 'org-real' },
        assertedOrganizationId: 'org-real',
    });
    assert.equal(scoped.ok, true);
    if (!scoped.ok) return;
    const saved = normalizeInitiativeDraft(draft({
        state: 'in_progress',
        successMetricLabel: 'Service page clicks',
    }));
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(initiativeRow(scoped, saved.value).organization_id, 'org-real');
    assert.equal(initiativeRow(scoped, saved.value).success_metric_label, 'Service page clicks');

    const incomplete = normalizeInitiativeDraft(draft({ state: 'completed_verified' }));
    assert.equal(incomplete.ok, false);
    const script = normalizeInitiativeDraft(draft({
        state: 'completed_verified',
        evidenceUrl: 'javascript:alert(1)',
        verifiedOn: '2026-10-04',
    }));
    assert.equal(script.ok, false);
    const published = normalizeInitiativeDraft(draft({
        items: [{ id: null, title: 'Draft note', contentState: 'published', draftUrl: '', liveUrl: '', publishedOn: '' }],
    }));
    assert.equal(published.ok, false);
    const ready = normalizeInitiativeDraft(draft({
        state: 'completed_verified',
        evidenceUrl: 'https://harbor.example/proof/profile',
        verifiedOn: '2026-10-04',
        items: [{
            id: 'not-a-uuid',
            title: 'Category update',
            contentState: 'published',
            draftUrl: '',
            liveUrl: 'https://harbor.example/blog/categories',
            publishedOn: '2026-10-04',
        }],
    }));
    assert.equal(ready.ok, true);
    if (!ready.ok) return;
    assert.equal(ready.value.items[0]?.id, null);
    assert.equal(ready.value.evidenceUrl, 'https://harbor.example/proof/profile');
});

test('initiative code does not read strategy plans, keyword lists, tasks, or deliverables', () => {
    const files = [
        new URL('./initiatives.ts', import.meta.url),
        new URL('./load.ts', import.meta.url),
        new URL('../../components/campaign-workspace/CampaignWorkspace.tsx', import.meta.url),
        new URL('../../components/campaign-workspace/RoadmapPanel.tsx', import.meta.url),
        new URL('../supabase/campaign-initiatives.ts', import.meta.url),
    ];
    for (const file of files) {
        const source = readFileSync(file, 'utf8');
        assert.equal(/campaign_plans|tracked_keywords|from\('tasks'\)|from\('deliverables'\)/.test(source), false, String(file));
    }
    const store = readFileSync(new URL('../supabase/campaign-initiatives.ts', import.meta.url), 'utf8');
    assert.match(store, /initiativeWriteScope/);
    assert.match(store, /from\('clients'\)/);
    assert.equal(/createAdminClient|service_role|organization_id:\s*input\.assertedOrganizationId/.test(store), false);
});
