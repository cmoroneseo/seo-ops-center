import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { BotTimerLookupError } from './handle.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function walkSources(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walkSources(path);
        if (name.endsWith('.test.ts')) return [];
        if (name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.md')) return [path];
        return [];
    });
}

const botTimerSources = [
    ...walkSources(join(repoRoot, 'lib/bots')),
    ...walkSources(join(repoRoot, 'app/api/bots')),
    join(repoRoot, 'app/api/cron/cap-bot-timers/route.ts'),
    join(repoRoot, 'docs/bot-time-api.md'),
];

function sliceBetween(source: string, start: string, end: string): string {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `missing ${start}`);
    return source.slice(from, to);
}

test('bot timer selects name the time_log_segments foreign key', () => {
    let embeds = 0;
    for (const file of botTimerSources) {
        const source = readFileSync(file, 'utf8');
        assert.doesNotMatch(
            source,
            /(?<!!)time_log_segments\(/,
            `${file} embeds time_log_segments from time_logs without a relationship hint`,
        );
        for (const embed of source.match(/time_log_segments[!(][^)]*\(/g) ?? []) {
            embeds += 1;
            assert.match(
                embed,
                /time_log_segments!time_log_segments_time_log_id_fkey\(/,
                `${file} has an ambiguous segment embed: ${embed}`,
            );
        }
    }
    const live = readFileSync(join(repoRoot, 'lib/bots/live.ts'), 'utf8');
    assert.match(
        live,
        /time_log_segments!time_log_segments_time_log_id_fkey\(started_at, ended_at, note\)/,
    );
    assert.ok(embeds >= 1, 'expected the bot timer select to embed segments');
});

test('timer lookups surface a database error instead of returning no timer', () => {
    const live = readFileSync(join(repoRoot, 'lib/bots/live.ts'), 'utf8');
    const lookups = [
        sliceBetween(live, 'async findRunningTimer', 'async listPausedTimers'),
        sliceBetween(live, 'async listPausedTimers', 'async listAllPausedTimers'),
        sliceBetween(live, 'async listAllPausedTimers', 'async listOverdueTimers'),
        sliceBetween(live, 'async listOverdueTimers', 'async getTimer'),
        sliceBetween(live, 'async getTimer', 'async insertRunningTimer'),
        sliceBetween(live, 'async pauseTimer', 'async resumeTimer'),
        sliceBetween(live, 'async resumeTimer', 'async finalizeTimer'),
    ];
    for (const body of lookups) {
        assert.match(body, /raiseTimerLookupError\(/);
        assert.doesNotMatch(body, /if \(error \|\| !data\) return null/);
        assert.doesNotMatch(body, /if \(readError \|\| !existing\) return null/);
    }
});

test('schema.sql records more than one time_log_segments foreign key to time_logs', () => {
    const sql = readFileSync(join(repoRoot, 'schema.sql'), 'utf8');
    const tableStart = sql.indexOf('create table if not exists public.time_log_segments (');
    const tableEnd = sql.indexOf('\n);', tableStart);
    assert.ok(tableStart >= 0 && tableEnd > tableStart);
    const inline = [...sql.slice(tableStart, tableEnd).matchAll(/references\s+public\.time_logs\b/gi)].length;
    const named = [...sql.matchAll(/alter table public\.time_log_segments\s+add constraint \w+\s+foreign key[\s\S]*?references\s+public\.time_logs\b/gi)].length;
    assert.ok(inline + named > 1, `expected more than one foreign key, found ${inline + named}`);
    assert.match(sql, /time_log_segments has two foreign keys to time_logs/);
    assert.match(sql, /time_log_segments_time_log_id_fkey/);
    assert.match(sql, /time_log_segments_parent_identity_fkey/);
    assert.match(sql, /time_log_segments!time_log_segments_time_log_id_fkey/);
});

test('a lookup error keeps only a safe database code', () => {
    assert.equal(new BotTimerLookupError('PGRST201').dbCode, 'PGRST201');
    assert.equal(new BotTimerLookupError('PGRST201').message, 'Bot timer lookup failed');
    const leaked = new BotTimerLookupError('Bearer seo_bot_testtokenvalue could not embed');
    assert.equal(leaked.dbCode, 'unknown');
    assert.equal(leaked.message.includes('seo_bot'), false);
    assert.equal(new BotTimerLookupError('PGRST201; select secret').dbCode, 'unknown');
});
