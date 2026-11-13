import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { clusterKey, type ArchitectGscCluster } from './architect-gsc.ts';
import { brandTokens, urlPath } from './page-match.ts';
import { validatePageMix, type MixInput } from './page-mix.ts';
import { queriesByPage } from './page-performance.ts';
import { OWN_DEMAND_MIN_IMPRESSIONS, planPages, type PagePlan } from './page-plan.ts';
import type { GscQueryEvidence, ReconcileContext } from './reconcile.ts';

const ignore = brandTokens('Acme', 'acme.com');
const site = 'https://www.acme.com';
const page = (path: string, title: string, h1 = title) => ({ pageId: path, normalizedUrl: `${site}${path}`, title, h1s: [h1], wordCount: 1000 });

/** A generic home-services site: service pages under /services/, city and county pages, one article. */
const pages = [
    page('/', 'Acme | Turf, Pavers & Outdoor Living'),
    page('/services/artificial-grass/', 'Artificial Grass Installation | Acme'),
    page('/services/pavers/', 'Paver Installation | Acme'),
    page('/services/pet-turf/', 'Pet Turf Installation | Acme'),
    page('/services/masonry/', 'Masonry | Acme'),
    page('/corona-ca/', 'Corona Hardscape Contractor | Pavers & Turf | Acme'),
    page('/riverside-ca/', 'Riverside Hardscape Contractor | Pavers & Turf | Acme'),
    page('/areas/orange-county-ca/', 'Outdoor Construction in Orange County, CA | Acme'),
    page('/areas/san-bernardino-county/', 'Artificial Grass San Bernardino, CA | Pavers | Acme'),
    page('/fire-pit-design/', 'Designing a Fire Pit | Acme'),
    page('/about-us/', 'About Acme'),
];

function cluster(query: string, impressions: number, variants: string[] = []): ArchitectGscCluster {
    return { query, clicks: 0, impressions, position: 20, variants, key: clusterKey(query, ignore) };
}

const clusters = [
    cluster('hardscaping services', 12000, ['hardscape contractor']),
    cluster('artificial turf installation near me', 3000, ['artificial grass installation near me', 'artificial turf services']),
    cluster('artificial grass installation corona', 800),
    cluster('custom hardscaping company', 490, ['custom hardscapes']),
    cluster('artificial turf san bernardino', 476),
    cluster('fire pit for covered patio', 400),
    cluster('backyard remodel orange county', 320),
    cluster('landscaping services corona', 300),
    cluster('pet turf installation', 250),
    cluster('hardscape contractor riverside', 212),
    cluster('artificial grass riverside', 200),
    cluster('pavers riverside', 170),
    cluster('paver installer near me', 160, ['pavers']),
    cluster('artificial grass irvine', 135),
    cluster('fire pit design ideas', 100),
    cluster('benefits of hardscaping', 60),
    cluster('paver company orange county', 13, ['paver installation orange county']),
    cluster('outdoor kitchen orange county', 4),
];

type Idea = MixInput & { title: string; silo?: number };
const city = (targetQuery: string, title: string, extra: Partial<Idea> = {}): Idea =>
    ({ pageType: 'service_city', targetQuery, title, demandQuery: targetQuery, buildPhase: 1, ...extra });
const service = (targetQuery: string, title: string, extra: Partial<Idea> = {}): Idea =>
    ({ pageType: 'service', targetQuery, title, demandQuery: targetQuery, buildPhase: 1, ...extra });

function plan(ideas: Idea[], options: { clusters?: ArchitectGscCluster[]; gscEvidence?: GscQueryEvidence[]; ctx?: ReconcileContext } = {}): PagePlan<number> {
    const groups = options.clusters ?? clusters;
    const mix = validatePageMix(ideas, groups, ignore, { services: ['artificial grass', 'pavers', 'hardscaping', 'landscaping'] });
    const byIndex = new Map(mix.kept.map(item => [item.index, item]));
    return planPages({
        ideas: ideas.flatMap((idea, index) => {
            const item = byIndex.get(index);
            return item ? [{ rec: index, mix: item, silo: idea.silo ?? 0, title: idea.title, buildPhase: idea.buildPhase ?? 1 }] : [];
        }),
        pages,
        gscEvidence: options.gscEvidence ?? [],
        clusters: groups,
        siloNames: ['Artificial Grass', 'Pavers & Hardscape', 'Outdoor Living'],
        ctx: { ignoreTokens: ignore, ...options.ctx },
    });
}

const all = (result: PagePlan<number>) => result.silos.flat();
const on = (result: PagePlan<number>, path: string) =>
    all(result).filter(item => item.reconciled.matchedUrl && urlPath(item.reconciled.matchedUrl) === path);
const byRec = (result: PagePlan<number>, rec: number) => all(result).find(item => item.rec === rec);

describe('planPages: one page, one idea', () => {
    it('merges ideas on the same city page into one: the most demand stays, the rest become supporting searches', () => {
        // Ecoworkz-like: turf, pavers and hardscape ideas all landed on /riverside-ca/.
        const result = plan([
            city('artificial grass riverside', 'Artificial Grass in Riverside, CA'),
            city('pavers riverside', 'Pavers in Riverside, CA', { supportingQueries: ['paver contractors riverside'] }),
            city('hardscape contractor riverside', 'Hardscape Contractor in Riverside, CA', { silo: 1 }),
        ]);
        const riverside = on(result, '/riverside-ca');
        assert.equal(riverside.length, 1);
        assert.equal(riverside[0].rec, 2);
        assert.equal(riverside[0].mix.targetQuery, 'hardscape contractor riverside');
        assert.deepEqual(riverside[0].mix.supportingQueries, ['artificial grass riverside', 'pavers riverside', 'paver contractors riverside']);
        assert.equal(riverside[0].reconciled.action === 'create', false);
        assert.equal(result.summary.merged_same_page, 2);
        // Every idea still has its page match for the duplicate-gate counts.
        assert.equal(result.reconciled.length, 3);
    });

    it('keeps the earliest on a tie and moves children of merged ideas to the kept idea', () => {
        const result = plan([
            city('hardscape contractor riverside', 'Hardscape Contractor in Riverside, CA', { parentIndex: 1, silo: 1 }),
            // Cites the same search, so the same demand.
            city('outdoor contractor riverside', 'Outdoor Contractor in Riverside, CA', { demandQuery: 'hardscape contractor riverside', parentIndex: 2, silo: 1 }),
            service('hardscaping services', 'Hardscaping Services', { silo: 1 }),
            city('artificial grass irvine', 'Artificial Grass Installation in Irvine, CA', { parentIndex: 1 }),
        ]);
        assert.equal(on(result, '/riverside-ca').map(item => item.rec).join(), '0');
        const index = (rec: number) => byRec(result, rec)?.mix.index;
        // The kept idea's parent was merged into it, so it takes that idea's parent.
        assert.equal(byRec(result, 0)?.mix.parentIndex, index(2));
        assert.equal(byRec(result, 3)?.mix.parentIndex, index(0));
        assert.equal(byRec(result, 1), undefined);
    });

    it('merges two articles that point at one existing post', () => {
        // Replaces the old rule that kept both (PR #272).
        const result = plan([
            { pageType: 'faq', targetQuery: 'fire pit design ideas', title: 'Fire Pit Design Ideas', demandQuery: 'fire pit design ideas', silo: 2 },
            { pageType: 'faq', targetQuery: 'fire pit for covered patio', title: 'Can You Put a Fire Pit Under a Covered Patio?', demandQuery: 'fire pit for covered patio', silo: 2 },
        ], { gscEvidence: [{ query: 'fire pit for covered patio', pageUrl: `${site}/fire-pit-design/`, position: 2, impressions: 400 }] });
        const post = on(result, '/fire-pit-design');
        assert.equal(post.length, 1);
        assert.equal(post[0].mix.targetQuery, 'fire pit for covered patio');
        assert.deepEqual(post[0].mix.supportingQueries, ['fire pit design ideas']);
    });

    it('the merged idea needs work when any merged idea found a reason', () => {
        const queryPages = [
            { query: 'artificial grass installation corona', page: `${site}/corona-ca/`, clicks: 5, impressions: 100, position: 3 },
            { query: 'landscaping services corona', page: `${site}/corona-ca/`, clicks: 0, impressions: 300, position: 15 },
        ];
        const ctx: ReconcileContext = { ignoreTokens: ignore, gscConnected: true, pageQueries: queriesByPage(queryPages), queryDays: 28 };
        const ideas = [
            city('artificial grass installation corona', 'Artificial Grass Installation in Corona, CA'),
            city('landscaping services corona', 'Landscaping Services in Corona, CA', { silo: 2 }),
        ];
        const alone = plan([ideas[0]], { ctx });
        assert.equal(on(alone, '/corona-ca')[0].reconciled.action, 'keep', 'on page 1 for its own search');
        const result = plan(ideas, { ctx });
        const corona = on(result, '/corona-ca');
        assert.equal(corona.length, 1);
        assert.equal(corona[0].mix.targetQuery, 'artificial grass installation corona');
        assert.equal(corona[0].reconciled.action, 'improve');
        assert.match(corona[0].reconciled.refresh?.reason ?? '', /landscaping services corona/);
    });

    it('a live county page named for its city takes the city idea as a Refresh, not a new page', () => {
        // Ecoworkz #5: "artificial turf san bernardino" was New next to a live San Bernardino County page titled for the city.
        const result = plan([city('artificial turf san bernardino', 'Artificial Grass Installation in San Bernardino')]);
        const county = on(result, '/areas/san-bernardino-county');
        assert.equal(county.length, 1);
        assert.notEqual(county[0].reconciled.action, 'create');
    });
});

describe('planPages: a new city page needs its own searches', () => {
    // Ecoworkz #16 and #21: pavers and BBQ islands in Orange County were New with 13 and 4 searches behind them.
    const ideas = [
        city('backyard remodel orange county', 'Backyard Remodel in Orange County', { silo: 2 }),
        city('paver installation orange county', 'Paver Installation in Orange County', { demandQuery: 'paver company orange county', silo: 1, parentIndex: 0 }),
        city('bbq island installation orange county', 'BBQ Island Installation in Orange County', { demandQuery: 'outdoor kitchen orange county', silo: 2 }),
        city('artificial grass irvine', 'Artificial Grass Installation in Irvine, CA'),
        // Cites a big but broader search, and the site has no Fontana page.
        city('pavers fontana', 'Pavers in Fontana, CA', { demandQuery: 'hardscaping services', silo: 1 }),
    ];

    it('folds into the idea for that place\'s existing page, or drops it when there is none', () => {
        // "paver company orange county" is the pavers idea's own search group, but below the floor.
        assert.ok(13 < OWN_DEMAND_MIN_IMPRESSIONS);
        const result = plan(ideas);
        const oc = on(result, '/areas/orange-county-ca');
        assert.equal(oc.length, 1);
        assert.equal(oc[0].rec, 0);
        assert.deepEqual(oc[0].mix.supportingQueries, ['paver installation orange county', 'bbq island installation orange county']);
        // Its own search has enough demand: stays a new page.
        assert.equal(byRec(result, 3)?.reconciled.action, 'create');
        assert.equal(byRec(result, 4), undefined);
        assert.deepEqual([result.summary.folded_local, result.summary.dropped_local], [2, 1]);
        assert.equal(all(result).some(item => item.reconciled.action === 'create' && item.mix.kind === 'service_city' && item.rec !== 3), false);
    });

    it('is not applied without Search Console data', () => {
        const result = plan(ideas, { clusters: [] });
        assert.equal(byRec(result, 1)?.reconciled.action, 'create');
        assert.deepEqual([result.summary.folded_local, result.summary.dropped_local, result.summary.service_pages_added], [0, 0, 0]);
    });
});

describe('planPages: service pages first', () => {
    const ideas = [
        city('artificial grass installation corona', 'Artificial Grass Installation in Corona, CA'),
        city('artificial grass irvine', 'Artificial Grass Installation in Irvine, CA', { buildPhase: 2 }),
        city('pavers riverside', 'Pavers in Riverside, CA', { silo: 1 }),
    ];

    it('adds a Refresh for every live service page with its own searches, ahead of the city versions', () => {
        const result = plan(ideas);
        // Ecoworkz-like: "artificial grass installation near me" lands on the turf service page, "paver installer near me" on the pavers page.
        const turf = on(result, '/services/artificial-grass')[0];
        assert.equal(turf.rec, null);
        assert.equal(turf.title, 'Artificial Grass Installation');
        assert.equal(turf.mix.targetQuery, 'artificial turf installation near me');
        assert.deepEqual(turf.mix.supportingQueries, ['artificial turf services'], '"artificial grass installation near me" is the same search');
        assert.equal(turf.reconciled.matchedUrl, `${site}/services/artificial-grass/`);
        assert.equal(turf.mix.demand?.impressions, 3000);
        assert.equal(on(result, '/services/pavers')[0].mix.targetQuery, 'paver installer near me');
        assert.equal(on(result, '/services/pet-turf').length, 1);
        assert.equal(on(result, '/services/masonry').length, 0, 'no searches for masonry');
        assert.equal(result.summary.service_pages_added, 3);

        assert.deepEqual(result.silos[0].map(item => item.rec ?? urlPath(item.reconciled.matchedUrl ?? '')),
            ['/services/artificial-grass', '/services/pet-turf', 0, 1]);
        assert.deepEqual(result.silos[1].map(item => item.rec ?? urlPath(item.reconciled.matchedUrl ?? '')), ['/services/pavers', 2]);
        for (const item of all(result).filter(x => x.rec == null)) {
            assert.equal(item.buildPhase, 1);
            assert.equal(item.mix.kind, 'service');
            assert.equal(item.mix.parentIndex, null);
        }
        // Indexes stay unique, so parents never point at the wrong idea.
        assert.equal(new Set(all(result).map(item => item.mix.index)).size, all(result).length);
    });

    it('moves the generator\'s own idea for a service page to the front instead of adding one', () => {
        const result = plan([...ideas, service('paver installation', 'Paver Installation', { silo: 1, buildPhase: 2 })]);
        const pavers = on(result, '/services/pavers');
        assert.equal(pavers.length, 1);
        assert.equal(pavers[0].rec, 3);
        assert.equal(pavers[0].buildPhase, 1);
        assert.equal(result.silos[1][0].rec, 3);
        assert.equal(result.summary.service_pages_added, 2);
    });

    it('leaves a service search another idea already aims at to that idea', () => {
        const result = plan([...ideas, service('pet turf installation', 'Pet Turf Installation in Orange County', { pageType: 'sub_service' })]);
        assert.equal(all(result).filter(item => item.mix.targetQuery === 'pet turf installation').length, 1);
    });

    it('gives a service idea narrower wordings of its service as supporting searches', () => {
        const result = plan([...ideas, service('hardscaping services', 'Hardscaping Services', { silo: 1 })]);
        const hardscape = all(result).find(item => item.mix.targetQuery === 'hardscaping services');
        assert.deepEqual(hardscape?.mix.supportingQueries, ['custom hardscaping company'], 'not "benefits of hardscaping" or a city search');
    });
});
