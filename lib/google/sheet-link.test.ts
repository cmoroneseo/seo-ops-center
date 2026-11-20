import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSheetLink, resolveSheetLinkPatch, sheetLinkRowPatch } from './sheet-link';

const sheetId = 'abcdefghijklmnopqrstuvwxyz_01234-56789';
const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}`;

test('normalizes pasted Google Sheets links', () => {
    for (const suffix of ['', '/edit', '/edit#gid=0', '?usp=sharing', '/copy?usp=sharing#gid=0']) {
        assert.deepEqual(parseSheetLink(`  ${sheetUrl}${suffix}  `), {
            ok: true,
            url: `${sheetUrl}/edit`,
            sheetId,
        });
    }

    for (const length of [25, 100]) {
        assert.equal(parseSheetLink(`https://docs.google.com/spreadsheets/d/${'a'.repeat(length)}`).ok, true);
    }
});

test('rejects links outside the supported sheet URL format', () => {
    for (const input of [
        sheetUrl.replace('https:', 'http:'),
        sheetUrl.replace('docs.google.com', 'example.com'),
        sheetUrl.replace('docs.google.com', 'docs.google.com.evil.com'),
        sheetUrl.replace('docs.google.com', 'evil.com/docs.google.com'),
        sheetUrl.replace('docs.google.com', 'docs.google.com@evil.com'),
        sheetUrl.replace('/d/', '/u/0/'),
        sheetUrl.replace(sheetId, 'a'.repeat(24)),
        sheetUrl.replace(sheetId, 'a'.repeat(101)),
        sheetUrl.replace(sheetId, `${sheetId}.extra`),
        `${sheetUrl}/${'a'.repeat(500)}`,
        '',
    ]) {
        assert.equal(parseSheetLink(input).ok, false, input);
    }
});

test('clears both fields for empty or whitespace input', () => {
    for (const input of ['', ' \t\n ']) {
        assert.deepEqual(resolveSheetLinkPatch(input), {
            ok: true,
            roadmapSheetUrl: null,
            roadmapSheetId: null,
        });
    }
});

test('derives both update columns from the URL and ignores supplied IDs', () => {
    assert.deepEqual(sheetLinkRowPatch({ roadmapSheetUrl: `${sheetUrl}#gid=0`, roadmapSheetId: 'ignored' }), {
        ok: true,
        roadmap_sheet_url: `${sheetUrl}/edit`,
        roadmap_sheet_id: sheetId,
    });
    assert.deepEqual(sheetLinkRowPatch({ roadmapSheetId: 'ignored' }), {
        ok: true,
        roadmap_sheet_url: undefined,
        roadmap_sheet_id: undefined,
    });

    for (const roadmapSheetUrl of ['', null]) {
        assert.deepEqual(sheetLinkRowPatch({ roadmapSheetUrl, roadmapSheetId: 'ignored' }), {
            ok: true,
            roadmap_sheet_url: null,
            roadmap_sheet_id: null,
        });
    }

    assert.equal(sheetLinkRowPatch({ roadmapSheetUrl: 'invalid' }).ok, false);
});
