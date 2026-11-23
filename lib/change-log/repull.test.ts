import assert from 'node:assert/strict';
import test from 'node:test';
import { runSeoTestRepull } from '../../scripts/seo-test-data-repull';

const now = new Date('2026-11-23T02:00:00Z');

test('the re-pull defaults to dry-run and requires the exact write flag', async () => {
    const messages: string[] = [];
    const write = async () => assert.fail('Dry-run must never reach the writer');
    await runSeoTestRepull([], now, write, message => messages.push(message));
    assert.match(messages.join('\n'), /Dry run/);
    assert.match(messages.join('\n'), /GSC: 2026-10-23 to 2026-11-21/);
    assert.match(messages.join('\n'), /GA4: 2026-10-24 to 2026-11-22/);
    for (const args of [['--commit'], ['--write=false'], ['--write', '--unexpected']]) {
        await assert.rejects(runSeoTestRepull(args, now, write, () => {}), /expected --write/);
    }
});

test('the exact write flag passes both 30-day windows to the sync writer', async () => {
    const calls: unknown[] = [];
    await runSeoTestRepull(['--write'], now, async windows => { calls.push(windows); }, () => {});
    assert.deepEqual(calls, [{
        gsc: { start: '2026-10-23', end: '2026-11-21' },
        ga4: { start: '2026-10-24', end: '2026-11-22' },
    }]);
});
