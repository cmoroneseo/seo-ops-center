import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectBreadcrumb } from '../../components/projects/ProjectBreadcrumb';

Object.assign(globalThis, { React });

test('project breadcrumb links to Projects and shows the current project name', () => {
    const html = renderToStaticMarkup(createElement(ProjectBreadcrumb, { clientId: 'client-1', title: 'City Pages' }));
    assert.match(html, /<nav aria-label="Breadcrumb"/);
    assert.match(html, /<a[^>]*href="\/workspace\/client-1\?tab=projects"[^>]*>Projects<\/a>/);
    assert.match(html, /<span aria-hidden="true">\/<\/span>/);
    assert.match(html, /<span[^>]*>City Pages<\/span>/);
    assert.doesNotMatch(html, /← Back to Projects/);
});
