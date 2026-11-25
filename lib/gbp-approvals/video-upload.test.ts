import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { prepareGbpVideo } from './video-upload';

const origin = 'http://[::1]:3000';
const objectId = '87234bca-a60a-410c-9d29-6772f3c39021';
const objectUrl = `blob:${origin}/${objectId}`;

function videoFixture(t: TestContext, createUrl: () => string) {
    const dom = new JSDOM('', { url: origin });
    const saved = { window: globalThis.window, document: globalThis.document };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document });
    t.after(() => {
        Object.assign(globalThis, saved);
        dom.window.close();
    });

    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const poster = new Blob(['poster'], { type: 'image/jpeg' });
    const sources: string[] = [];
    const setSource = (url: string) => {
        sources.push(url);
        video.dispatchEvent(new dom.window.Event('loadedmetadata'));
    };
    Object.defineProperties(video, {
        src: { set: setSource },
        duration: { value: 3 },
        videoWidth: { value: 1280 },
        videoHeight: { value: 720 },
        readyState: { value: 2 },
    });
    t.mock.method(video, 'setAttribute', (name: string, value: string) => {
        assert.equal(name, 'src');
        setSource(value);
    });
    const reset = t.mock.method(video, 'load', () => {});
    let frame: unknown;
    t.mock.method(canvas, 'getContext', () => ({
        drawImage: (...args: unknown[]) => { frame = args; },
    }));
    t.mock.method(canvas, 'toBlob', (callback: BlobCallback, type: string) => {
        assert.equal(type, 'image/jpeg');
        callback(poster);
    });
    t.mock.method(document, 'createElement', (tag: string) => {
        assert.ok(tag === 'video' || tag === 'canvas');
        return tag === 'video' ? video : canvas;
    });
    t.mock.method(URL, 'createObjectURL', createUrl);
    const revoked: string[] = [];
    t.mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url));
    return { video, poster, sources, reset, revoked, frame: () => frame };
}

test('a same-origin object URL loads video metadata and a JPEG poster and is revoked', async t => {
    const fixture = videoFixture(t, () => objectUrl);
    const file = new File(['video'], 'fixture.mp4', { type: 'video/mp4' });
    assert.deepEqual(await prepareGbpVideo(file), {
        file, contentType: 'video/mp4',
        metadata: { durationSeconds: 3, width: 1280, height: 720 },
        poster: fixture.poster,
    });
    assert.deepEqual(fixture.sources, [objectUrl]);
    assert.deepEqual(fixture.frame(), [fixture.video, 0, 0, 960, 540]);
    assert.deepEqual(fixture.revoked, [objectUrl]);
    assert.equal(fixture.reset.mock.callCount(), 1);
});

test('a non-blob, off-origin or malformed object URL never reaches the media source', async t => {
    const invalid = [`${origin}/file.mp4`, `blob:https://other.test/${objectId}`, `${objectUrl}"><img>`, `${objectUrl}\n`];
    let candidate = '';
    const fixture = videoFixture(t, () => candidate);
    const file = new File(['video'], 'fixture.mp4', { type: 'video/mp4' });
    for (candidate of invalid) {
        await assert.rejects(prepareGbpVideo(file), /local video preview/);
    }
    assert.deepEqual(fixture.sources, []);
    assert.deepEqual(fixture.revoked, invalid);
});
