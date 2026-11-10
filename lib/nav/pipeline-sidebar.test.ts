import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the sidebar and mobile menu read the pipeline flag and render nested links', () => {
    const sidebar = readFileSync(new URL('../../components/dashboard/Sidebar.tsx', import.meta.url), 'utf8');
    const mobile = readFileSync(new URL('../../components/dashboard/MobileNav.tsx', import.meta.url), 'utf8');
    assert.match(sidebar, /pipelineNavEnabled\(\)/);
    assert.match(sidebar, /pipelineNav/);
    assert.match(sidebar, /link\.children/);
    assert.match(mobile, /pipelineNavEnabled\(\)/);
    assert.match(mobile, /link\.children/);
});
