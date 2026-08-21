import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sources = {
    'components/timer/FloatingTimer.tsx': readFileSync(new URL('../../components/timer/FloatingTimer.tsx', import.meta.url), 'utf8'),
    'components/timer/TimerChip.tsx': readFileSync(new URL('../../components/timer/TimerChip.tsx', import.meta.url), 'utf8'),
};

test('the stop review sheet outlives the timer that opened it', () => {
    // Finalizing the last attempt makes primaryTimer null. If the sheet is only
    // rendered in the has-a-timer branch, the parent unmounts it the instant the
    // entry is confirmed and the completion/Basecamp warning is never seen.
    for (const [file, source] of Object.entries(sources)) {
        const guard = source.indexOf('if (!primaryTimer)');
        assert.ok(guard > -1, `${file} should short-circuit when no timer is active`);

        const endOfGuard = source.indexOf('\n    }', guard);
        const earlyReturn = source.slice(guard, endOfGuard);
        assert.match(
            earlyReturn,
            /StopConfirmSheet/,
            `${file} unmounts the review sheet when the last attempt finalizes`,
        );
    }
});
