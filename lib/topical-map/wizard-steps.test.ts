import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WizardStepper } from '../../components/topical-map/MapGenerationWizard.tsx';
import { WIZARD_STEPS, continueLabel, wizardStepperItems } from './wizard-steps.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('the stepper names the four steps and marks done only from saved data', () => {
    const items = wizardStepperItems({ current: 'keywords', brandDone: true, competitorsDone: true, keywordsDone: false });
    assert.deepEqual(WIZARD_STEPS, ['profile', 'seeds', 'keywords', 'confirm']);
    assert.deepEqual(items.map(item => item.label), ['Brand', 'Competitors', 'Keywords', 'Review and build']);
    assert.deepEqual(items.map(item => item.statusLabel), ['Done', 'Done', 'Current step', 'Not started']);

    // Jumping straight to keywords with no competitors saved does not call them done.
    const jumped = wizardStepperItems({ current: 'keywords', brandDone: true, competitorsDone: false, keywordsDone: true });
    assert.deepEqual(jumped.map(item => item.status), ['done', 'todo', 'current', 'todo']);
});

test('the continue button counts the chosen keywords and names the last step', () => {
    assert.equal(continueLabel('keywords', 8), 'Continue with 8 keywords');
    assert.equal(continueLabel('keywords', 1), 'Continue with 1 keyword');
    assert.equal(continueLabel('keywords', 0), 'Continue with 0 keywords');
    assert.equal(continueLabel('profile', 3), 'Continue');
    assert.equal(continueLabel('confirm', 3), 'Build topic map');
});

test('the stepper renders the current step once, with done steps checked', () => {
    const html = renderToStaticMarkup(createElement(WizardStepper, {
        items: wizardStepperItems({ current: 'keywords', brandDone: true, competitorsDone: true, keywordsDone: false }),
    }));
    assert.match(html, /aria-label="Steps"/);
    assert.equal(html.match(/aria-current="step"/g)?.length, 1);
    assert.equal(html.match(/>Done</g)?.length, 2);
    assert.match(html, /Keywords<\/b><small[^>]*text-\[#be185d\][^>]*>Current step/);
    assert.match(html, /Review and build<\/b><small[^>]*>Not started/);
});
