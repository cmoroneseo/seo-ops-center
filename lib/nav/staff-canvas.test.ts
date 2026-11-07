import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('the organization switcher sits in the sidebar, not the top bar', () => {
    const sidebar = source('../../components/dashboard/Sidebar.tsx');
    const topNav = source('../../components/dashboard/TopNav.tsx');
    const shell = source('../../components/dashboard/DashboardShell.tsx');
    const css = source('../../app/globals.css');

    assert.match(sidebar, /OrganizationSwitcher/);
    assert.match(sidebar, /staff-sidebar/);
    assert.doesNotMatch(topNav, /OrganizationSwitcher/);
    assert.match(topNav, /Search/);
    assert.match(shell, /staff-canvas/);
    assert.match(css, /\.staff-canvas/);
    assert.match(css, /\.staff-sidebar/);
    assert.match(css, /#f4f4f6/);
});
