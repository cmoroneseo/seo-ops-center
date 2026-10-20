import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const floating = readFileSync(new URL('../../components/timer/FloatingTimer.tsx', import.meta.url), 'utf8');
const quickStart = readFileSync(new URL('../../components/timer/QuickStartPopover.tsx', import.meta.url), 'utf8');

test('the floating timer running accent, pulse, and primary button are pink', () => {
    assert.equal(floating.includes('green-'), false);
    assert.match(floating, /bg-\[#ec4899\] animate-pulse/);
    assert.match(floating, /text-\[#ec4899\]/);
    assert.match(floating, /bg-\[#ec4899\]\/15 text-\[#ec4899\]/);
    assert.equal(quickStart.includes('green-'), false);
    assert.match(quickStart, /bg-\[#ec4899\]/);
});
