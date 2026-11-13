import test from 'node:test';
import assert from 'node:assert/strict';

import {
    answerBriefFor,
    answerNote,
    BRIEF_COLUMNS,
    briefFromRow,
    briefToRow,
    defaultSchemaType,
    fitAnswer,
    insertSkippingMissingColumns,
    needsPriceTable,
    schemaTypeFor,
} from './answer-brief.ts';
import { buildSystemPrompt } from './generate-prompt.ts';
import { pageKindOf, storedPageType } from './page-mix.ts';
import { approvalTaskDescription, countWords } from './spec.ts';
import type { TopicalMapRecord } from '../types.ts';

/** A compact model response shaped like the Ecoworkz map: one full record, one with no brief, one with a 75-word answer. */
const MODEL_RESPONSE = JSON.stringify({
    architecture_summary: 'Money pages first.',
    silos: [{
        name: 'Artificial Grass',
        description: 'Turf installation across the Inland Empire',
        search_intent: 'commercial',
        records: [
            {
                page_type: 'service_city',
                title: 'Artificial Grass Installation in Corona, CA',
                target_query: 'artificial grass installation corona',
                supporting_queries: ['artificial turf corona', 'turf installers corona ca', 'synthetic grass corona'],
                demand_query: 'artificial grass installation company corona',
                seed_only: false,
                build_phase: 1,
                answer: 'Ecoworkz installs artificial grass across Corona, CA for homes, pets and play areas. Most Corona yards take two to three days: we remove the old lawn, build a compacted base, lay and seam the turf, then add infill. Every install includes a drainage check and a written warranty from our own crew.',
                ai_prompts: ['Who installs artificial grass in Corona CA?', 'How long does turf installation take in Corona?', '## Who installs artificial grass in Corona CA?'],
                h2s: ['## How we install turf in Corona', 'H2: Turf options for Corona yards', 'Pet-friendly turf', 'Corona neighborhoods we serve'],
                schema_type: 'LocalBusiness',
            },
            {
                page_type: 'cost',
                title: 'Artificial Turf Cost in the Inland Empire',
                target_query: 'artificial turf cost',
                supporting_queries: ['artificial grass price per square foot', 'turf installation cost', 'fake grass cost'],
                demand_query: null,
                seed_only: true,
                build_phase: 2,
            },
            {
                page_type: 'faq',
                title: 'Is Artificial Turf Safe for Dogs?',
                target_query: 'is artificial turf safe for dogs',
                supporting_queries: ['pet turf safe', 'artificial grass dogs', 'dog friendly turf'],
                demand_query: 'pet turf',
                seed_only: false,
                build_phase: 2,
                answer: 'Yes, artificial turf is safe for dogs when it is made for pets and installed with a drainage base. Pet turf uses a flow-through backing so urine drains straight down, and an antimicrobial infill keeps odors down. Ecoworkz installs pet turf in Corona, Riverside and Temecula. Rinse it weekly in summer. Most owners find it easier to keep clean than grass and dirt, and their dogs come back inside without muddy paws all year long.',
                ai_prompts: ['Is artificial grass safe for dogs?'],
                h2s: ['Why pet turf is safe', 'How pet turf drains', 'Keeping pet turf clean'],
                schema_type: 'Service',
                price_table: false,
            },
        ],
    }],
});

function parsedRecords(): Array<Record<string, unknown>> {
    const parsed = JSON.parse(MODEL_RESPONSE) as { silos: Array<{ records: Array<Record<string, unknown>> }> };
    return parsed.silos[0].records;
}

/** What the route does per kept record. */
function briefOf(rec: Record<string, unknown>) {
    const text = `${String(rec.title)} ${String(rec.target_query)}`;
    const kind = pageKindOf(rec.page_type, text);
    return answerBriefFor(rec, { kind, storedType: storedPageType(kind, text) }, text);
}

test('a full model record keeps its answer, prompts, headings and a refined schema type', () => {
    const { answerFirst60, brief } = briefOf(parsedRecords()[0]);
    assert.ok(answerFirst60);
    assert.equal(countWords(answerFirst60), 52);
    assert.deepEqual(brief.aiPrompts, ['Who installs artificial grass in Corona CA?', 'How long does turf installation take in Corona?']);
    assert.deepEqual(brief.headings, ['How we install turf in Corona', 'Turf options for Corona yards', 'Pet-friendly turf', 'Corona neighborhoods we serve']);
    assert.equal(brief.schemaType, 'LocalBusiness', 'the model may switch a city service page to LocalBusiness');
    assert.equal(brief.priceTable, false);
    assert.equal(brief.answerTrimmed, false);
});

test('a record with no brief fields still gets a schema type and a price table from its page type', () => {
    const { answerFirst60, brief } = briefOf(parsedRecords()[1]);
    assert.equal(answerFirst60, null);
    assert.deepEqual(brief, { aiPrompts: [], headings: [], schemaType: 'Article', priceTable: true, answerTrimmed: false });
});

test('a 75-word answer is cut at a sentence end inside 40-60 words and flagged', () => {
    const rec = parsedRecords()[2];
    assert.equal(countWords(String(rec.answer)), 75);
    const { answerFirst60, brief } = briefOf(rec);
    assert.ok(answerFirst60);
    const words = countWords(answerFirst60);
    assert.ok(words >= 40 && words <= 60, String(words));
    assert.equal(answerFirst60, 'Yes, artificial turf is safe for dogs when it is made for pets and installed with a drainage base. Pet turf uses a flow-through backing so urine drains straight down, and an antimicrobial infill keeps odors down. Ecoworkz installs pet turf in Corona, Riverside and Temecula. Rinse it weekly in summer.');
    assert.equal(brief.answerTrimmed, true);
    assert.equal(brief.schemaType, 'Article', 'a money-page type is not allowed on an article');
    assert.equal(answerNote(answerFirst60, brief.answerTrimmed), `Shortened to ${words} words.`);
});

test('an over-long answer with no sentence end in range is cut at 60 words with an ellipsis', () => {
    const fit = fitAnswer(Array.from({ length: 80 }, (_, i) => `word${i}`).join(' '));
    assert.equal(fit.trimmed, true);
    assert.equal(countWords(fit.answer ?? ''), 60);
    assert.ok(fit.answer?.endsWith('word59…'));
    assert.deepEqual(fitAnswer('  '), { answer: null, trimmed: false });
    assert.deepEqual(fitAnswer(42), { answer: null, trimmed: false });
    assert.equal(answerNote('Short answer here.', false), '3 words. Aim for 40 to 60.');
});

test('schema type comes from the page kind; the model refines it only within the kind', () => {
    assert.equal(defaultSchemaType('service'), 'Service');
    assert.equal(defaultSchemaType('sub_service'), 'Service');
    assert.equal(defaultSchemaType('service_city'), 'Service');
    assert.equal(defaultSchemaType('city'), 'LocalBusiness');
    assert.equal(defaultSchemaType('faq', 'faq'), 'FAQPage');
    assert.equal(defaultSchemaType('faq', 'blog_post'), 'Article');
    assert.equal(defaultSchemaType('cost'), 'Article');
    assert.equal(defaultSchemaType('comparison'), 'Article');
    assert.equal(defaultSchemaType('local_resource'), 'Article');
    assert.equal(schemaTypeFor('local_resource', 'resource_center', 'HowTo'), 'HowTo');
    assert.equal(schemaTypeFor('faq', 'blog_post', 'faq'), 'FAQPage');
    assert.equal(schemaTypeFor('service', 'service', 'Article'), 'Service');
    assert.equal(schemaTypeFor('service', 'service', 'Product'), 'Service');
});

test('cost pages and priced titles always get a price table; the model can only add one', () => {
    assert.equal(needsPriceTable('cost', 'Turf guide', false), true);
    assert.equal(needsPriceTable('comparison', 'Turf vs Pavers: Cost and Upkeep', undefined), true);
    assert.equal(needsPriceTable('service', 'Paver Installation', 'yes'), false);
    assert.equal(needsPriceTable('service', 'Paver Installation', true), true);
});

test('the stored brief round-trips and rejects anything that is not a brief', () => {
    const { brief } = briefOf(parsedRecords()[0]);
    assert.deepEqual(briefFromRow(JSON.parse(JSON.stringify(briefToRow(brief)))), brief);
    assert.equal(briefFromRow(null), undefined);
    assert.equal(briefFromRow([]), undefined);
    assert.equal(briefFromRow({ headings: ['x'] }), undefined);
    assert.deepEqual(briefFromRow({ schema_type: 'Service', ai_prompts: 'not a list' }), {
        aiPrompts: [], headings: [], schemaType: 'Service', priceTable: false, answerTrimmed: false,
    });
});

test('the approval task carries the brief', () => {
    const { answerFirst60, brief } = briefOf(parsedRecords()[1]);
    const description = approvalTaskDescription({
        id: 'r', siloId: 's', mapId: 'm', organizationId: 'o', pageType: 'guide', action: 'create',
        title: 'Artificial Turf Cost', targetQuery: 'artificial turf cost', wordCountMin: 0, wordCountMax: 0,
        buildPhase: 2, scopeExclusions: [], outgoingLinks: [], status: 'pending', sortOrder: 0, createdAt: '', updatedAt: '',
        answerFirst60: answerFirst60 ?? undefined,
        answerBrief: { ...brief, aiPrompts: ['How much does turf cost?'], headings: ['Price per square foot'] },
    } satisfies TopicalMapRecord);
    assert.match(description, /\*\*Questions people ask AI assistants:\*\* How much does turf cost\?/);
    assert.match(description, /\*\*Section headings:\*\* Price per square foot/);
    assert.match(description, /\*\*Page markup for search engines:\*\* Article/);
    assert.match(description, /\*\*Price table:\*\* Include a price table with the date the prices were checked\./);
});

test('an insert drops a brief column whose migration is not applied, and remembers it', async () => {
    const missing = new Set<string>();
    const sent: Array<string[]> = [];
    const insert = async (row: Record<string, unknown>) => {
        sent.push(Object.keys(row).sort());
        if ('answer_brief' in row) {
            return { data: null, error: { code: 'PGRST204', message: "Could not find the 'answer_brief' column of 'topical_map_records' in the schema cache" } };
        }
        return { data: { id: 'r-1' }, error: null };
    };
    const row = { title: 'A', answer_first_60: 'x', answer_brief: {} };
    assert.deepEqual(await insertSkippingMissingColumns(row, BRIEF_COLUMNS, missing, insert), { data: { id: 'r-1' }, error: null });
    assert.deepEqual([...missing], ['answer_brief']);
    await insertSkippingMissingColumns(row, BRIEF_COLUMNS, missing, insert);
    assert.deepEqual(sent, [['answer_brief', 'answer_first_60', 'title'], ['answer_first_60', 'title'], ['answer_first_60', 'title']]);
});

test('an unnamed missing column drops every brief column; other errors pass through', async () => {
    const missing = new Set<string>();
    const result = await insertSkippingMissingColumns(
        { title: 'A', answer_first_60: 'x', answer_brief: {} },
        BRIEF_COLUMNS,
        missing,
        async row => ('answer_first_60' in row || 'answer_brief' in row)
            ? { data: null, error: { code: '42703', message: 'column does not exist' } }
            : { data: { id: 'r-2' }, error: null },
    );
    assert.deepEqual(result.data, { id: 'r-2' });
    assert.deepEqual([...missing].sort(), ['answer_brief', 'answer_first_60']);
    const failed = await insertSkippingMissingColumns({ title: 'A' }, BRIEF_COLUMNS, new Set(), async () => ({ data: null, error: { code: '23514', message: 'check' } }));
    assert.equal(failed.error?.code, '23514');
});

test('the prompt asks for the brief compactly and its example answers are 40-60 words', () => {
    const prompt = buildSystemPrompt();
    assert.match(prompt, /Answer-ready brief/);
    assert.match(prompt, /no indentation or line breaks/);
    const answers = [...prompt.matchAll(/"answer": "([^"]+)"/g)].map(match => countWords(match[1]));
    assert.equal(answers.length, 2);
    for (const words of answers) assert.ok(words >= 40 && words <= 60, String(words));
});
