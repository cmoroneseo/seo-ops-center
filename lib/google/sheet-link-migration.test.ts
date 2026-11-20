import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/133_client_roadmap_sheet.sql', import.meta.url), 'utf8');
const clientId = '11111111-1111-4111-8111-111111111111';
const sheetId = 'abcdefghijklmnopqrstuvwxyz_01234-56789';
const sheetBase = 'https://docs.google.com/spreadsheets/d/';
const sheetUrl = `${sheetBase}${sheetId}/edit`;

test('migration 133 is re-runnable and enforces paired, matching sheet links', async () => {
    const db = new PGlite();
    try {
        await db.exec('create table public.clients (id uuid primary key, name text)');
        await db.exec(migration);
        await db.query(
            'insert into public.clients (id, name, roadmap_sheet_url, roadmap_sheet_id) values ($1, $2, $3, $4)',
            [clientId, 'Test Client', sheetUrl, sheetId],
        );
        await db.exec(migration);

        const update = (url: string | null, id: string | null) => db.query(
            'update public.clients set roadmap_sheet_url = $1, roadmap_sheet_id = $2 where id = $3 returning roadmap_sheet_url, roadmap_sheet_id',
            [url, id, clientId],
        );

        assert.deepEqual((await update(null, null)).rows, [{ roadmap_sheet_url: null, roadmap_sheet_id: null }]);
        assert.deepEqual((await update(sheetUrl, sheetId)).rows, [{ roadmap_sheet_url: sheetUrl, roadmap_sheet_id: sheetId }]);

        await assert.rejects(update(sheetUrl, null), { code: '23514', constraint: 'clients_roadmap_sheet_pair_check' });
        await assert.rejects(update(null, sheetId), { code: '23514', constraint: 'clients_roadmap_sheet_pair_check' });
        await assert.rejects(update(sheetUrl, 'b'.repeat(25)), { code: '23514', constraint: 'clients_roadmap_sheet_match_check' });
        await assert.rejects(update(sheetUrl.replace('https:', 'http:'), sheetId), { code: '23514', constraint: 'clients_roadmap_sheet_url_check' });
        await assert.rejects(update(`${sheetBase}/edit`, sheetId), { code: '23514', constraint: 'clients_roadmap_sheet_url_check' });
        await assert.rejects(update(`${sheetUrl}/${'a'.repeat(500)}`, sheetId), { code: '23514', constraint: 'clients_roadmap_sheet_url_check' });
        await assert.rejects(update(sheetUrl, 'invalid'), { code: '23514', constraint: 'clients_roadmap_sheet_id_check' });
    } finally {
        await db.close();
    }
});
