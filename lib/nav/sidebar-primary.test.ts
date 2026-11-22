import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MyTasksBadge } from '@/components/dashboard/MyTasksBadge';

test('the My Tasks badge distinguishes loading, a positive count, and zero', () => {
    const loading = renderToStaticMarkup(createElement(MyTasksBadge, { count: null }));
    assert.match(loading, /aria-busy="true"/);
    assert.match(loading, /motion-safe:animate-pulse/);
    const overdue = renderToStaticMarkup(createElement(MyTasksBadge, { count: 3 }));
    assert.match(overdue, /aria-label="3 overdue tasks"/);
    assert.match(overdue, />3<\/span>/);
    assert.equal(renderToStaticMarkup(createElement(MyTasksBadge, { count: 0 })), '');
});
