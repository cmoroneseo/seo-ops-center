import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import { ClientSetup, SetupChecklistView } from '../../components/onboarding/SetupChecklist.tsx';
import {
    SETUP_LOAD_FAILED,
    SETUP_STEP_ORDER,
    clientDetailsDone,
    deriveSetupChecklist,
    planBuilt,
    setupChecklistPanel,
    setupChecklistRows,
    setupChecklistVisible,
    setupProgress,
    topicMapBuiltFrom,
    wizardStepForSetup,
    type SetupChecklistFacts,
} from './setup-checklist.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function facts(patch: Partial<SetupChecklistFacts> = {}): SetupChecklistFacts {
    return {
        clientName: 'Northside Plumbing',
        brandName: 'Northside Plumbing',
        businessDescription: 'Local plumbing',
        competitors: ['rival.example'],
        keywords: ['roof repair'],
        googleAccess: { gsc: 'connected', ga4: 'connected', gtm: 'connected' },
        topicMapBuilt: true,
        marketingPlanItemCount: 2,
        initiativeCount: 0,
        ...patch,
    };
}

const options = { clientId: 'client id', campaignWorkspace: false };

test('setup steps follow the client setup order and link to the place each one is done', () => {
    const steps = deriveSetupChecklist(facts({
        clientName: '  ',
        brandName: '',
        businessDescription: 'Plumbing',
        competitors: [],
        keywords: ['  '],
        googleAccess: { gsc: 'not-connected', ga4: 'not-connected', gtm: 'not-connected' },
        topicMapBuilt: false,
        marketingPlanItemCount: 0,
        initiativeCount: 0,
    }), { ...options, campaignWorkspace: true });
    assert.deepEqual(steps.map(step => step.label), [
        'Add client details',
        'Confirm brand',
        'Competitors',
        'Keywords',
        'Connect Google Search Console',
        'Connect Google Analytics (GA4)',
        'Connect Google Tag Manager',
        'Build topic map',
        'Build plan',
    ]);
    assert.deepEqual(SETUP_STEP_ORDER, steps.map(step => step.id));
    assert.ok(steps.every(step => step.done === false));
    assert.equal(steps[0].href, '/workspace/client%20id?tab=overview&setup=details');
    assert.equal(steps[1].href, '/workspace/client%20id?tab=topical-map&setup=brand');
    assert.equal(steps[2].href, '/workspace/client%20id?tab=topical-map&setup=competitors');
    assert.equal(steps[3].href, '/workspace/client%20id?tab=topical-map&setup=keywords');
    assert.equal(steps[4].href, '/workspace/client%20id?tab=integrations&setup=search-console');
    assert.equal(steps[5].href, '/workspace/client%20id?tab=integrations&setup=ga4');
    assert.equal(steps[6].href, '/workspace/client%20id?tab=integrations&setup=gtm');
    assert.equal(steps[7].href, '/workspace/client%20id?tab=topical-map&setup=generate');
    assert.equal(steps[8].href, '/workspace/client%20id?tab=campaign-workspace');
    assert.equal(deriveSetupChecklist(facts(), options).find(step => step.id === 'plan')?.href, '/workspace/client%20id?tab=campaign');
    assert.equal(wizardStepForSetup('keywords'), 'keywords');
    assert.equal(wizardStepForSetup('generate'), 'confirm');
    assert.equal(wizardStepForSetup('details'), null);
});

test('each step is done only from real state, and a failed read stays unknown', () => {
    assert.equal(clientDetailsDone('Northside'), true);
    assert.equal(clientDetailsDone('  '), false);

    assert.equal(topicMapBuiltFrom({ status: 'missing' }), false);
    assert.equal(topicMapBuiltFrom({ status: 'unknown' }), null);
    assert.equal(topicMapBuiltFrom({ status: 'present', stages: ['profile', 'search_demand', 'your_pages'], recordCount: 0 }), false);
    assert.equal(topicMapBuiltFrom({ status: 'present', stages: ['complete'], recordCount: 0 }), true);
    assert.equal(topicMapBuiltFrom({ status: 'present', stages: ['architect'], recordCount: 3 }), true);

    assert.equal(planBuilt(0, 0), false);
    assert.equal(planBuilt(null, null), null);
    assert.equal(planBuilt(0, null), null);
    assert.equal(planBuilt(1, null), true);
    assert.equal(planBuilt(0, 1), true);

    const unknown = deriveSetupChecklist(facts({
        brandName: null,
        businessDescription: null,
        competitors: null,
        keywords: null,
        googleAccess: null,
        topicMapBuilt: null,
        marketingPlanItemCount: null,
        initiativeCount: null,
    }), options);
    assert.equal(unknown[0].done, true);
    assert.ok(unknown.slice(1).every(step => step.done === null));
});

test('Google steps complete independently when each service has access to its saved resource', () => {
    const steps = deriveSetupChecklist(facts({
        googleAccess: { gsc: 'connected', ga4: 'pick', gtm: 'needs-reconnect' },
    }), options);
    assert.deepEqual(steps.slice(4, 7).map(step => [step.id, step.done]), [
        ['search-console', true],
        ['ga4', false],
        ['gtm', false],
    ]);
    assert.ok(deriveSetupChecklist(facts(), options).slice(4, 7).every(step => step.done === true));
});

test('done rows say Done, the first open step is the only Next up with the only primary button, and the topic map waits on keywords', () => {
    const steps = deriveSetupChecklist(facts({
        competitors: [],
        keywords: [],
        googleAccess: { gsc: 'not-connected', ga4: 'not-connected', gtm: 'not-connected' },
        topicMapBuilt: false,
        marketingPlanItemCount: 0,
        initiativeCount: null,
    }), options);
    const rows = setupChecklistRows(steps);
    assert.deepEqual(rows.map(row => row.state), ['done', 'done', 'next', 'todo', 'todo', 'todo', 'todo', 'locked', 'unknown']);
    assert.equal(rows.find(row => row.id === 'topic-map')?.lockedReason, 'needs keywords first');
    assert.deepEqual(setupProgress(steps), { done: 2, total: 9, left: 7, percent: 22 });

    const html = renderToStaticMarkup(createElement(SetupChecklistView, {
        clientName: 'Northside Plumbing', steps, panel: 'list', onDismiss: () => {},
    }));
    assert.equal(html.match(/>Done</g)?.length, 2);
    assert.equal(html.match(/Next up/g)?.length, 1);
    assert.equal(html.match(/aria-current="step"/g)?.length, 1);
    assert.match(html, /data-state="next"[^>]*bg-\[#fdf2f8\]/);
    // Only one primary (dark, 44px) button on the list.
    assert.equal(html.match(/h-11 [^"]*bg-\[#18181b\]/g)?.length, 1);
    assert.match(html, /h-11[^>]*>Add competitors/);
    assert.match(html, /Not started · needs keywords first/);
    assert.match(html, /Couldn&#x27;t check/);
    assert.equal(html.includes('Not done'), false);
});

test('client details are done with only a name, because the create form marks the website optional', () => {
    // A client created without a website: nothing in the facts carries one.
    const steps = deriveSetupChecklist(facts({ clientName: 'No Website Co' }), options);
    assert.equal(steps[0].id, 'details');
    assert.equal(steps[0].done, true);
    assert.equal(deriveSetupChecklist(facts({ clientName: ' ' }), options)[0].done, false);
});

test('the list hides when every step is done or when it is dismissed, and a failed load does not invent not-done', () => {
    const steps = deriveSetupChecklist(facts(), options);
    assert.equal(setupChecklistVisible(steps, false), false);
    assert.equal(setupChecklistPanel({ status: 'ready', steps, dismissed: false }), 'hidden');
    assert.equal(setupChecklistVisible(steps.map((step, index) => index === 3 ? { ...step, done: false } : step), false), true);
    assert.equal(setupChecklistVisible(steps.map(step => ({ ...step, done: null })), true), false);
    assert.equal(setupChecklistPanel({ status: 'loading', steps, dismissed: true }), 'hidden');
    assert.equal(setupChecklistPanel({ status: 'loading', steps: [], dismissed: false }), 'loading');
    assert.equal(setupChecklistPanel({ status: 'failed', steps, dismissed: false }), 'unavailable');

    const open = deriveSetupChecklist(facts({ keywords: [], topicMapBuilt: false, marketingPlanItemCount: 0, initiativeCount: 0 }), options);
    const list = renderToStaticMarkup(createElement(SetupChecklistView, {
        clientName: 'Northside Plumbing',
        steps: open,
        panel: 'list',
        onDismiss: () => {},
    }));
    assert.match(list, /Finish setting up Northside Plumbing/);
    assert.match(list, /6 of 9 done/);
    assert.match(list, /3 to go/);
    assert.match(list, /role="progressbar"[^>]*aria-valuemax="9"[^>]*aria-valuenow="6"/);
    assert.match(list, /Add client details/);
    assert.match(list, /href="\/workspace\/client%20id\?tab=topical-map&amp;setup=keywords"/);
    assert.match(list, />Hide</);

    const hidden = renderToStaticMarkup(createElement(SetupChecklistView, { clientName: 'Northside Plumbing', steps, panel: 'hidden', onDismiss: () => {} }));
    assert.equal(hidden, '');
    const failed = renderToStaticMarkup(createElement(SetupChecklistView, { clientName: 'Northside Plumbing', steps: open, panel: 'unavailable', onDismiss: () => {} }));
    assert.ok(failed.includes('Couldn&#x27;t load setup progress. Refresh to try again.'));
    assert.equal(SETUP_LOAD_FAILED, "Couldn't load setup progress. Refresh to try again.");
    assert.equal(failed.includes('Not done'), false);
    assert.equal(failed.includes(' done<'), false);
    assert.equal(failed.includes('progressbar'), false);
});

test('the Overview loads Google access even with a saved checklist dismissal', async t => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/' });
    t.mock.method(globalThis, 'fetch', async input => {
        assert.equal(input, '/api/integrations/status?clientId=client&orgId=org');
        return Response.json({ integrations: [
            { service: 'gsc', syncStatus: 'active', selectedProperty: 'sc-domain:example.com', needsPropertySetup: false },
            { service: 'ga4', syncStatus: 'error' },
            { service: 'gtm', syncStatus: 'pending_setup' },
        ] });
    });
    const previousWindow = globalThis.window;
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const container = dom.window.document.getElementById('root')!;
    const root = createRoot(container);
    try {
        dom.window.localStorage.setItem('seo-ops.setup-checklist.dismissed.client', '1');
        await act(async () => {
            root.render(createElement(ClientSetup, { clientId: 'client', organizationId: 'org', clientName: 'Northside Plumbing' }));
        });
        assert.equal(container.querySelector('#setup-checklist-title'), null);
        const strip = container.querySelector('[aria-labelledby="google-access-title"]');
        assert.ok(strip);
        assert.deepEqual(Array.from(strip.querySelectorAll('a'), link => [link.getAttribute('aria-label'), link.getAttribute('href')]), [
            ['GSC Connected. Open Google Search Console settings', '/workspace/client?tab=integrations&setup=search-console'],
            ['GA4 Needs reconnect. Open Google Analytics (GA4) settings', '/workspace/client?tab=integrations&setup=ga4'],
            ['GTM Pick container. Open Google Tag Manager settings', '/workspace/client?tab=integrations&setup=gtm'],
        ]);
        assert.equal(strip.querySelector('button'), null);
    } finally {
        act(() => root.unmount());
        globalThis.window = previousWindow;
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
        dom.window.close();
    }
});
