import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MyTasksBadge } from '@/components/dashboard/MyTasksBadge';

test('the My Tasks badge shows a positive count and renders nothing at zero', () => {
    const overdue = renderToStaticMarkup(createElement(MyTasksBadge, { count: 3 }));
    assert.match(overdue, /aria-label="3 overdue tasks"/);
    assert.match(overdue, />3<\/span>/);
    assert.equal(renderToStaticMarkup(createElement(MyTasksBadge, { count: 0 })), '');
});
