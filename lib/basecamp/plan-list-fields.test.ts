import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BasecampPlanListFields } from '../../components/workspace/BasecampPlanListFields.tsx';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('the two Basecamp lists say which one is imported and which one receives new work', () => {
    const html = renderToStaticMarkup(createElement(BasecampPlanListFields, {
        lists: [
            { id: 10388242459, title: 'Set up SEO campaign' },
            { id: 10388242991, title: 'SEO' },
        ],
        seoPlanTodolistId: '10388242991',
        onboardingTodolistId: '10388242459',
        onSeoPlanChange: () => {},
        onOnboardingChange: () => {},
    }));
    assert.match(html, /SEO Plan list/);
    assert.match(html, /push to this list only/);
    assert.match(html, /Onboarding list/);
    assert.match(html, /Nothing pushes here/);
    assert.match(html, /Set up SEO campaign/);
    assert.match(html, /value="10388242991"/);
    assert.match(html, /value="10388242459"/);
});
