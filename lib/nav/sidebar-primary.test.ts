import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MyTasksBadge } from '@/components/dashboard/MyTasksBadge';
import { isAgencyLinkActive } from './staff-shell';

test('the My Tasks badge distinguishes loading, a positive count, and zero', () => {
    const loading = renderToStaticMarkup(createElement(MyTasksBadge, { count: null }));
    assert.match(loading, /aria-busy="true"/);
    assert.match(loading, /motion-safe:animate-pulse/);
    const overdue = renderToStaticMarkup(createElement(MyTasksBadge, { count: 3 }));
    assert.match(overdue, /aria-label="3 of your tasks overdue"/);
    assert.match(overdue, />3<\/span>/);
    assert.equal(renderToStaticMarkup(createElement(MyTasksBadge, { count: 0 })), '');
});

test('the mobile bottom bar keeps five primary tabs and matches Clients exactly', () => {
    const source = readFileSync(new URL('../../components/dashboard/MobileNav.tsx', import.meta.url), 'utf8');
    const primaryTabs = source.match(/const primaryTabs = \[([^\]]*)\]/)?.[1] ?? '';
    const tabs = Array.from(primaryTabs.matchAll(/name: '([^']+)', href: '([^']+)'/g), ([, name, href]) => [name, href]);
    assert.deepEqual(tabs, [
        ['Home', '/dashboard'],
        ['Clients', '/workspace'],
        ['My Tasks', '/tasks'],
        ['Approvals', '/approvals'],
        ['Deliverables', '/deliverables'],
    ]);
    assert.match(source, /const active = isAgencyLinkActive\(pathname, tab\.href\)/);
    assert.equal(isAgencyLinkActive('/workspace', tabs[1][1]), true);
    assert.equal(isAgencyLinkActive('/workspace/summit', tabs[1][1]), false);
});
