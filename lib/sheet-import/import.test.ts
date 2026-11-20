import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    applyImport, buildImportKey, buildPreview, mapPhase, mapStatus, mapStepKey, parseContentPlan,
    parsePreviewCsv, parseRoadmap, planApply, toPreviewCsv, type ImportDeps, type Manifest,
} from './index';

const sheetId = 'abcdefghijklmnopqrstuvwxyz';
const clientId = '11111111-1111-4111-8111-111111111111';

test('maps sheet statuses, phases and categories', () => {
    for (const [input, plan, task] of [
        [' Complete ', 'done', 'done'], ['DONE', 'done', 'done'], ['in   progress', 'todo', 'in_progress'],
        ['In Review', 'todo', 'in_progress'], ['Not Started', 'todo', 'todo'], ['Idea', 'todo', 'todo'],
        ['', 'todo', 'todo'], ['Unknown', 'todo', 'todo'],
    ]) {
        assert.equal(mapStatus(input, 'marketing_plan_items'), plan);
        assert.equal(mapStatus(input, 'tasks'), task);
    }
    for (const [label, launch, phase] of [
        ['Month 1', null, 'month_1'], ['Month 2', null, 'month_2'], ['Month 3', null, 'month_3'],
        ['Month 5', null, 'backlog'], ['Onboarding', null, 'onboarding'],
        ['October 2026', '2026-08-06', 'month_3'], ['October 2026', null, 'backlog'],
        ['Oct 2026', '2026-11-01', 'onboarding'], ['M1 (Nov 2026)', '2026-11-30', 'month_1'],
        ['Dec 2026', '2026-11-30', 'month_2'], ['Jan 2027', '2026-11-30', 'month_3'],
        ['', null, 'backlog'], ['Soon', null, 'backlog'],
    ] as const) {
        assert.deepEqual(mapPhase(label, launch), { phase, monthLabel: label });
    }
    for (const [category, key] of [
        ['Local SEO', 'local'], ['Analytics & Reporting', 'setup'], ['Technical', 'technical'],
        ['Technical SEO', 'technical'], ['On-Page', 'onpage'], ['On-page SEO', 'onpage'],
        ['Content', 'content'], ['Links', 'links'], ['Link Building', 'links'], ['Off-Page', 'links'],
        ['Research', 'research'], ['Keyword Research', 'research'], ['Other', 'setup'],
    ]) assert.equal(mapStepKey(category), key);
    assert.equal(buildImportKey(sheetId, 'Content Plan', 4), `sheet:${sheetId}:Content Plan:4`);
    assert.throws(() => buildImportKey('short', 'Roadmap', 1));
    assert.throws(() => buildImportKey(sheetId, 'bad:tab', 1));
    assert.throws(() => buildImportKey(sheetId, 'Roadmap', 1000000));
});

const grids = { [clientId]: {
    Roadmap: [
        ['Roadmap'], ['Client'], [], ['Overall Progress'], ['Instructions'],
        ['Phase', 'Timeline', 'Initiative / Deliverable', 'Category', 'Owner', 'Target Month', 'Status', 'Why It Matters / Notes', "What You'll Get"],
        ['', '', 'Audit the Website', 'Technical', '', 'Month 5', 'In Progress', 'First note', 'A report'],
        [],
        ['', '', 'Already done', 'Content', '', 'Month 1', 'Done'],
    ],
    'Content Plan': [
        ['Month', 'Published Date', 'Status', 'Content Type', 'Title', 'KW', 'Volume', 'KD', 'Due Date'],
        ['', '', '', '', 'EXAMPLE - skip me'],
        ['Oct 2026', '', 'Idea', 'Article', 'Write a Guide', 'guides', '100', '20', '10/15'],
        [],
        ['', '', '', '', 'Unlisted idea'],
    ],
} };

const manifest: Manifest = { clients: [{
    clientId, clientName: 'Example Client', organizationId: clientId, marketingPlanId: null,
    launchDate: '2026-08-06', sheetId,
    rows: [
        { tab: 'Roadmap', row: 7, action: 'create' },
        { tab: 'Content Plan', row: 3, action: 'create' },
        { tab: 'Roadmap', row: 9, action: 'skip', coveredBy: 'existing-task' },
    ],
    existing: { planItems: [], tasks: [{ id: 'duplicate', title: 'Audit Website!' }] },
}] };

test('parses physical sheet row numbers and previews only listed rows', () => {
    assert.deepEqual(parseRoadmap(grids[clientId].Roadmap).map(row => row.row), [7, 9]);
    assert.deepEqual(parseContentPlan(grids[clientId]['Content Plan']).map(row => row.row), [3, 5]);
    const [item, task, skip] = buildPreview(manifest, grids);
    assert.equal(item.approve, '');
    assert.equal(item.possible_duplicate_of, 'duplicate');
    assert.equal(item.match_score, '1');
    assert.equal(item.needs_new_plan, 'yes');
    assert.match(item.notes, /Example Client — SEO Plan/);
    assert.match(item.description, /^Sheet: Month 5\n/);
    assert.match(item.description, /First note[\s\S]*A report[\s\S]*Roadmap row 7/);
    assert.equal(task.stage, 'backlog');
    assert.match(task.description, /Content Type: Article[\s\S]*Due Date: 10\/15[\s\S]*Month: Oct 2026/);
    assert.equal(skip.covered_by, 'existing-task');
    assert.match(skip.notes, /likely covered by existing task existing-task/);
});

test('preview CSV round-trips quoted fields and guards formula prefixes', () => {
    const [row] = buildPreview(manifest, grids);
    const special = { ...row, title: '=SUM(1,2)', description: 'First, "quoted"\r\nSecond line', notes: "'@literal" };
    assert.deepEqual(parsePreviewCsv(toPreviewCsv([special])), [special]);
    for (const prefix of ['=', '+', '-', '@']) {
        const csv = toPreviewCsv([{ ...row, title: prefix + 'unsafe' }]);
        assert.ok(csv.includes(`,'${prefix}unsafe,`));
    }
});

test('apply planning accepts approved creates only and reports invalid approved rows', () => {
    const [item, task, skip] = buildPreview(manifest, grids);
    const plan = planApply([{ ...item, approve: ' yEs ' }, { ...task, approve: 'N' }, { ...skip, approve: 'Y' }]);
    assert.equal(plan.approvedCount, 1);
    assert.equal(plan.planItems[0].payload.source, 'sheet');
    assert.equal(plan.tasks.length, 0);
    assert.deepEqual(plan.errors, []);
    for (const invalid of [
        { ...item, import_key: 'invalid' }, { ...item, roadmap_phase: 'month_5' },
        { ...item, status: 'in_progress' }, { ...task, category: 'technical' },
        { ...task, stage: 'month_1' }, { ...task, title: '' },
    ]) {
        const rejected = planApply([{ ...invalid, approve: 'Y' }]);
        assert.equal(rejected.errors.length, 1);
        assert.equal(rejected.planItems.length + rejected.tasks.length, 0);
    }
});

test('apply is offline with injected deps, dry-run is read-only, and execution is idempotent', async context => {
    context.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected fetch during import'));
    const plan = planApply(buildPreview(manifest, grids).map(row => ({ ...row, approve: 'Y' })));
    const itemKeys = new Set<string>();
    const taskKeys = new Set<string>();
    const calls: string[] = [];
    const deps: ImportDeps = {
        async findExistingImportKeys() {
            return { planItems: [...itemKeys], tasks: [...taskKeys] };
        },
        async findPlan() { return 'plan-id'; },
        async getOrCreatePlan(_clientId, title) {
            calls.push('getOrCreatePlan');
            assert.equal(title, 'Example Client — SEO Plan');
            return 'plan-id';
        },
        async maxSortOrder() { return 4; },
        async insertPlanItems(rows) {
            calls.push('insertPlanItems');
            assert.equal(rows[0].sort_order, 5);
            rows.forEach(row => itemKeys.add(row.import_key));
            return rows.length;
        },
        async insertTasks(rows) {
            calls.push('insertTasks');
            assert.deepEqual(rows[0], plan.tasks[0]);
            rows.forEach(row => taskKeys.add(row.import_key));
            return rows.length;
        },
    };
    const dry = await applyImport(plan, deps);
    assert.deepEqual(calls, []);
    assert.equal(dry.planItems[0].sort_order, 5);
    assert.equal(dry.tasks.length, 1);
    assert.equal(dry.inserted, 0);
    const first = await applyImport(plan, deps, { execute: true });
    const second = await applyImport(plan, deps, { execute: true });
    assert.equal(first.inserted, 2);
    assert.equal(first.skipped, 0);
    assert.equal(second.inserted, 0);
    assert.equal(second.skipped, 2);
    assert.deepEqual(calls, ['getOrCreatePlan', 'insertPlanItems', 'insertTasks']);
});

test('import sources have no integration or bot write dependencies', () => {
    const directory = new URL('./', import.meta.url);
    const sources = readdirSync(directory, { recursive: true }).filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
        .map(file => new URL(file, directory));
    sources.push(new URL('../../scripts/sheets/import-sheet-rows.ts', directory));
    for (const source of sources) {
        const code = readFileSync(source, 'utf8');
        assert.doesNotMatch(code, /['"](?:[^'"]*\/)?(?:basecamp|bots|supabase\/tasks)(?:\/|['"])/i, source.pathname);
    }
});
