import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { routeAfterOrganizationChange } from './route-after-switch.ts';
import { MissingClient } from '../../components/workspace/MissingClient.tsx';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const sandbox = '/workspace/cbba5b14-7e24-4913-b396-0fff7fb2df17';

test('an organization switch leaves client and report records for an org-level page', () => {
    assert.equal(routeAfterOrganizationChange(sandbox), '/workspace');
    assert.equal(routeAfterOrganizationChange(`${sandbox}?tab=vault`), '/workspace');
    assert.equal(routeAfterOrganizationChange(`${sandbox}/`), '/workspace');
    assert.equal(routeAfterOrganizationChange('/client-portal/cbba5b14-7e24-4913-b396-0fff7fb2df17'), '/workspace');
    assert.equal(routeAfterOrganizationChange('/reports/9f0c1c2a-6b3d-4e5f-8a71-2c4d6e8f0a12'), '/reports');
    assert.equal(routeAfterOrganizationChange('/workspace'), null);
    assert.equal(routeAfterOrganizationChange('/dashboard'), null);
    assert.equal(routeAfterOrganizationChange('/deliverables'), null);
    assert.equal(routeAfterOrganizationChange('/reports'), null);
    assert.equal(routeAfterOrganizationChange('/reports/close'), null);
    assert.equal(routeAfterOrganizationChange('/tasks'), null);
    assert.equal(routeAfterOrganizationChange('/settings'), null);
});

test('a client missing from the active organization renders a not-found state', () => {
    const html = renderToStaticMarkup(createElement(MissingClient, { organizationName: 'Marketing Empire Group' }));
    assert.match(html, /Client not found/);
    assert.match(html, /outside Marketing Empire Group/);
    assert.match(html, /href="\/workspace"/);
    assert.match(html, /Back to clients/);
    assert.equal(html.trim().length > 0, true);
});
