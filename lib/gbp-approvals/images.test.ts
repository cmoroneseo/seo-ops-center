import assert from 'node:assert/strict';
import test from 'node:test';

import { sniffImage, uploadKeyMatches } from './images.ts';

const requestId = '11111111-1111-4111-8111-111111111111';

test('image bytes must match a photo signature', async () => {
    const { default: sharp } = await import('sharp');
    for (const format of ['jpeg', 'png', 'webp', 'gif'] as const) {
        const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).toFormat(format).toBuffer();
        assert.equal(sniffImage(bytes), format);
    }
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

test('reserved images must decode and match type, size, and pixel limits', async () => {
    const { default: sharp } = await import('sharp');
    const { verifyReservedImage } = await import('./images.ts');
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
    assert.equal(await verifyReservedImage(png, 'image/png', png.length), true);
    assert.equal(await verifyReservedImage(png, 'image/jpeg', png.length), false);
    assert.equal(await verifyReservedImage(png, 'image/png', png.length + 1), false);
    assert.equal(await verifyReservedImage(png.subarray(0, 24), 'image/png', 24), false);
    const fake = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(await verifyReservedImage(fake, 'image/png', fake.length), false);
    const wide = await sharp({ create: { width: 10001, height: 1, channels: 3, background: 'white' } }).png().toBuffer();
    assert.equal(await verifyReservedImage(wide, 'image/png', wide.length), false);
    assert.equal(await verifyReservedImage(new Uint8Array(10 * 1024 * 1024 + 1), 'image/png', 10 * 1024 * 1024 + 1), false);
});
