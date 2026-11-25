import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gbpPostMediaSchema, gbpMediaError, inspectMp4VideoBuffer, MAX_GBP_VIDEO_BYTES, parseGbpVideoPath } from './video';
import { clientVisibleChange, visibleSnapshot } from './registry';
import { post } from '../approvals-v2/test-database';

function box(type: string, ...chunks: Buffer[]) {
    const size = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const header = Buffer.alloc(8);
    header.writeUInt32BE(size);
    header.write(type, 4);
    return Buffer.concat([header, ...chunks]);
}

function movie({ version = 0, duration = 30000, width = 1280, height = 720, brand = 'isom', handler = 'vide' } = {}) {
    const mvhd = Buffer.alloc(version ? 112 : 100);
    mvhd[0] = version;
    mvhd.writeUInt32BE(1000, version ? 20 : 12);
    if (version) mvhd.writeBigUInt64BE(BigInt(duration), 24);
    else mvhd.writeUInt32BE(duration, 16);
    const tkhd = Buffer.alloc(version ? 96 : 84);
    tkhd[0] = version;
    tkhd.writeUInt32BE(width * 65536, version ? 88 : 76);
    tkhd.writeUInt32BE(height * 65536, version ? 92 : 80);
    const hdlr = Buffer.alloc(24);
    hdlr.write(handler, 8);
    return Buffer.concat([
        box('ftyp', Buffer.from(brand), Buffer.alloc(4)),
        box('moov', box('mvhd', mvhd), box('trak', box('tkhd', tkhd), box('mdia', box('hdlr', hdlr)))),
        box('mdat', Buffer.from('data')),
    ]);
}

test('reads version 0 MP4, version 1 QuickTime, and the real local H.264 sample', () => {
    assert.deepEqual(inspectMp4VideoBuffer(movie()), { ok: true, durationSeconds: 30, width: 1280, height: 720 });
    assert.deepEqual(inspectMp4VideoBuffer(movie({ version: 1, brand: 'qt  ', duration: 2500, width: 720, height: 1280 })),
        { ok: true, durationSeconds: 2.5, width: 720, height: 1280 });
    const sample = readFileSync(new URL('../../public/dev/gbp-approvals/sample.mp4', import.meta.url));
    assert.deepEqual(inspectMp4VideoBuffer(sample), { ok: true, durationSeconds: 3, width: 1280, height: 720 });

    const normal = movie();
    const extended = Buffer.alloc(8);
    extended.writeBigUInt64BE(24n);
    const header = Buffer.from(normal.subarray(0, 8));
    header.writeUInt32BE(1);
    assert.equal(inspectMp4VideoBuffer(Buffer.concat([header, extended, normal.subarray(8)])).ok, true);
});

test('rejects malformed headers, out-of-range duration, low resolution and oversized files', () => {
    const inputs = [
        [movie({ duration: 30001 }), /30 seconds/],
        [movie({ version: 1, duration: Number.MAX_SAFE_INTEGER }), /30 seconds/],
        [movie({ duration: 0 }), /duration/],
        [movie({ width: 719 }), /720p/],
        [movie({ brand: 'heic' }), /MP4 or MOV/],
        [movie({ handler: 'soun' }), /video track/],
        [movie().subarray(0, -1), /MP4 or MOV/],
        [Buffer.from('an image'), /MP4 or MOV/],
        [new Uint8Array(MAX_GBP_VIDEO_BYTES + 1), /75 MB/],
    ] as const;
    const invalidExtended = Buffer.from(movie());
    invalidExtended.writeUInt32BE(1);
    invalidExtended.writeBigUInt64BE(BigInt('18446744073709551615'), 8);
    assert.equal(inspectMp4VideoBuffer(invalidExtended).ok, false);
    for (const [bytes, expected] of inputs) {
        const result = inspectMp4VideoBuffer(bytes);
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.error, expected);
    }
});

test('enforces media exclusion, scope of path formats, and video-visible changes', () => {
    const videoPath = 'https://media.example/video.mp4';
    const videoPosterPath = 'https://media.example/poster.jpg';
    const stored = 'approval-assets/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';
    assert.equal(parseGbpVideoPath(stored), stored);
    assert.equal(parseGbpVideoPath(stored, true), null);
    assert.equal(parseGbpVideoPath('http://example.test/video.mp4'), null);
    assert.equal(parseGbpVideoPath('https://' + 'x'.repeat(500)), null);
    assert.equal(gbpMediaError({ videoPath, videoPosterPath, photoPath: null, photoPaths: [] }), null);
    assert.match(gbpMediaError({ videoPath, photoPaths: [videoPosterPath] })!, /one video/);
    assert.match(gbpMediaError({ videoPath, photoPath: videoPosterPath, photoPaths: [] })!, /one video/);
    assert.ok(gbpMediaError({ videoPath: [videoPath] }));
    assert.equal(gbpPostMediaSchema.safeParse({ videoPath, photoPaths: [] }).success, true);
    assert.equal(gbpPostMediaSchema.safeParse({ videoPath, photoPaths: [videoPosterPath] }).success, false);
    assert.ok(gbpMediaError({ videoPosterPath }));
    assert.match(gbpMediaError({ videoPath, videoPosterPath: videoPath })!, /separate image/);
    assert.ok(gbpMediaError({ videoPath }, { page: true }));
    const payload = { ...post('Fixture').payload, postType: 'offer' as const, schemaVersion: 1 as const };
    const before = visibleSnapshot(payload, []);
    const after = visibleSnapshot(payload, [], videoPath);
    assert.equal(clientVisibleChange(before, after), true);
    assert.equal(clientVisibleChange(after, visibleSnapshot(payload, [], videoPath)), false);
    assert.equal(clientVisibleChange(after, visibleSnapshot(payload, [], videoPath, videoPosterPath)), true);
});
