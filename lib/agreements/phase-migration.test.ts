import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/088_task_agreement_phase.sql', import.meta.url), 'utf8');

test('task agreement phase is additive and mirrored into schema.sql', async () => {
    assert.doesNotMatch(migration, /update\s+(public\.)?tasks/i);
    assert.equal(migration.includes('basecamp_group_id'), false);
    assert.match(migration, /plan_phase ~ '\^month_\[1-9\]\[0-9\]\*\$'/);
    assert.ok(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8').includes(migration.trim()));
    const db = new PGlite();
    try {
        await db.exec(`
            create table deliverable_commitments(id uuid primary key);
            create table tasks(id uuid primary key, client_id uuid, title text);
        `);
        await db.exec(migration);
        const commitment = '00000000-0000-0000-0000-000000000040';
        const task = '00000000-0000-0000-0000-000000000030';
        await db.query('insert into deliverable_commitments(id) values ($1)', [commitment]);
        const inserted = await db.query<{ plan_phase_locked: boolean }>('insert into tasks(id, title, commitment_id) values ($1, $2, $3) returning plan_phase_locked', [task, 'Rank tracking', commitment]);
        assert.equal(inserted.rows[0].plan_phase_locked, false);
        await db.query("update tasks set plan_phase = 'onboarding'");
        await db.query("update tasks set plan_phase = 'month_14'");
        await assert.rejects(db.query("update tasks set plan_phase = 'month_0'"), /tasks_plan_phase_check/);
        await assert.rejects(db.query("update tasks set plan_phase = 'month_'"), /tasks_plan_phase_check/);
        await db.query('delete from deliverable_commitments where id = $1', [commitment]);
        assert.equal((await db.query<{ commitment_id: string | null }>('select commitment_id from tasks')).rows[0].commitment_id, null);
        const index = await db.query<{ indexname: string }>("select indexname from pg_indexes where indexname = 'tasks_client_plan_phase_idx'");
        assert.equal(index.rows[0]?.indexname, 'tasks_client_plan_phase_idx');
    } finally {
        await db.close();
    }
});
