import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SetupChecklistView } from '../../components/onboarding/SetupChecklist.tsx';
import {
    SETUP_LOAD_FAILED,
    SETUP_STEP_ORDER,
    clientDetailsDone,
    deriveSetupChecklist,
    planBuilt,
    searchConsoleConnectedFromIntegration,
    setupChecklistPanel,
    setupChecklistVisible,
    topicMapBuiltFrom,
    wizardStepForSetup,
    type SetupChecklistFacts,
} from './setup-checklist.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function facts(patch: Partial<SetupChecklistFacts> = {}): SetupChecklistFacts {
    return {
        clientName: 'Northside Plumbing',
        website: 'https://northside.example',
        brandName: 'Northside Plumbing',
        businessDescription: 'Local plumbing',
        competitors: ['rival.example'],
        keywords: ['roof repair'],
        searchConsoleConnected: true,
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
        website: '   ',
        brandName: '',
        businessDescription: 'Plumbing',
        competitors: [],
        keywords: ['  '],
        searchConsoleConnected: false,
        topicMapBuilt: false,
        marketingPlanItemCount: 0,
        initiativeCount: 0,
    }), { ...options, campaignWorkspace: true });
    assert.deepEqual(steps.map(step => step.label), [
        'Add client details',
        'Confirm brand',
        'Competitors',
        'Keywords',
        'Connect Search Console',
        'Build topic map',
        'Build plan',
    ]);
    assert.deepEqual(SETUP_STEP_ORDER, steps.map(step => step.id));
    assert.deepEqual(steps.map(step => step.done), [false, false, false, false, false, false, false]);
    assert.equal(steps[0].href, '/workspace/client%20id?tab=overview&setup=details');
    assert.equal(steps[1].href, '/workspace/client%20id?tab=topical-map&setup=brand');
    assert.equal(steps[2].href, '/workspace/client%20id?tab=topical-map&setup=competitors');
    assert.equal(steps[3].href, '/workspace/client%20id?tab=topical-map&setup=keywords');
    assert.equal(steps[4].href, '/workspace/client%20id?tab=integrations&setup=search-console');
    assert.equal(steps[5].href, '/workspace/client%20id?tab=topical-map&setup=generate');
    assert.equal(steps[6].href, '/workspace/client%20id?tab=campaign-workspace');
    assert.equal(deriveSetupChecklist(facts(), options)[6].href, '/workspace/client%20id?tab=campaign');
    assert.equal(wizardStepForSetup('keywords'), 'keywords');
    assert.equal(wizardStepForSetup('generate'), 'confirm');
    assert.equal(wizardStepForSetup('details'), null);
});

test('each step is done only from real state, and a failed read stays unknown', () => {
    assert.equal(clientDetailsDone('Northside', 'https://northside.example'), true);
    assert.equal(clientDetailsDone('Northside', '  '), false);
    assert.equal(searchConsoleConnectedFromIntegration(null), false);
    assert.equal(searchConsoleConnectedFromIntegration('unknown'), null);
    assert.equal(searchConsoleConnectedFromIntegration({ syncStatus: 'active', selectedProperty: '' }), false);
    assert.equal(searchConsoleConnectedFromIntegration({ syncStatus: 'active', needsPropertySetup: true, selectedProperty: 'sc-domain:a.com' }), false);
    assert.equal(searchConsoleConnectedFromIntegration({ syncStatus: 'disconnected', selectedProperty: 'sc-domain:a.com' }), false);
    assert.equal(searchConsoleConnectedFromIntegration({ syncStatus: 'error', selectedProperty: 'sc-domain:a.com' }), false);
    assert.equal(searchConsoleConnectedFromIntegration({ syncStatus: 'active', selectedProperty: 'sc-domain:a.com' }), true);

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
        searchConsoleConnected: null,
        topicMapBuilt: null,
        marketingPlanItemCount: null,
        initiativeCount: null,
    }), options);
    assert.equal(unknown[0].done, true);
    assert.deepEqual(unknown.slice(1).map(step => step.done), [null, null, null, null, null, null]);
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
        steps: open,
        panel: 'list',
        onDismiss: () => {},
    }));
    assert.match(list, /Set up this client/);
    assert.match(list, /Add client details/);
    assert.match(list, /Keywords/);
    assert.match(list, /Not done/);
    assert.match(list, /Done/);
    assert.match(list, /href="\/workspace\/client%20id\?tab=topical-map&amp;setup=keywords"/);
    assert.equal(list.includes('0 of'), false);

    const hidden = renderToStaticMarkup(createElement(SetupChecklistView, { steps, panel: 'hidden', onDismiss: () => {} }));
    assert.equal(hidden, '');
    const failed = renderToStaticMarkup(createElement(SetupChecklistView, { steps: open, panel: 'unavailable', onDismiss: () => {} }));
    assert.ok(failed.includes('Couldn&#x27;t load setup progress. Refresh to try again.'));
    assert.equal(SETUP_LOAD_FAILED, "Couldn't load setup progress. Refresh to try again.");
    assert.equal(failed.includes('Not done'), false);
    assert.equal(failed.includes('0'), false);
});
