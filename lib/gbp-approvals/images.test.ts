import assert from 'node:assert/strict';
import test from 'node:test';

import { sniffImage, uploadKeyMatches } from './images.ts';

const requestId = '11111111-1111-4111-8111-111111111111';

test('image bytes must match a photo signature', () => {
    assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0, 0, 0, 0, 0, 0, 0, 0])), 'jpeg');
    assert.equal(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), 'png');
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    assert.equal(sniffImage(svg), null);
    assert.equal(sniffImage(new TextEncoder().encode('<script>alert(1)</script>')), null);
});

test('an upload key cannot point at another request', () => {
    const own = `gbp-approvals/${requestId}/22222222-2222-4222-8222-222222222222`;
    assert.equal(uploadKeyMatches(requestId, own), true);
    assert.equal(uploadKeyMatches(requestId, 'gbp-approvals/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222'), false);
    assert.equal(uploadKeyMatches(requestId, `gbp-approvals/${requestId}/../secret`), false);
    assert.equal(uploadKeyMatches(requestId, 'https://allinone-const.com/photo.jpg'), false);
});
