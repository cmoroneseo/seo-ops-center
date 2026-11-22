import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the sidebar and mobile menu read the pipeline flag and render nested links', () => {
    const sidebar = readFileSync(new URL('../../components/dashboard/Sidebar.tsx', import.meta.url), 'utf8');
    const mobile = readFileSync(new URL('../../components/dashboard/MobileNav.tsx', import.meta.url), 'utf8');
    assert.match(sidebar, /pipelineNavEnabled\(\)/);
    assert.match(sidebar, /pipelineNav/);
    assert.match(sidebar, /const children = visibleStaffChildren\(link, isActive\)/);
    assert.match(sidebar, /section\.label && section\.links\.length > 0 &&/);
    assert.match(sidebar, /menu === 'more' && section\.overflow\.map/);
    assert.match(mobile, /section\.overflow\?\.map/);
    assert.match(mobile, /pipelineNavEnabled\(\)/);
    assert.match(mobile, /const children = visibleStaffChildren\(link, isActive\)/);
});
