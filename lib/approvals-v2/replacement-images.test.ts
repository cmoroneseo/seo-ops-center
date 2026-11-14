import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { replacementMagic, replacementPreview } from './replacement-images.ts';

test('magic bytes and actual decode reject spoofed, unsupported, oversized, and mismatched files', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
  assert.equal(replacementMagic(png), 'image/png');
  assert.equal(replacementMagic(Buffer.from('<script>fake.png</script>')), null);
  assert.equal(replacementMagic(Buffer.alloc(15728641)), null);
  await assert.rejects(replacementPreview(png, 'image/jpeg', png.length));
  await assert.rejects(replacementPreview(png, 'image/png', png.length + 1));
  const converted = await replacementPreview(png, 'image/png', png.length);
  assert.equal((await sharp(converted).metadata()).format, 'jpeg');
  assert.equal((await sharp(converted).metadata()).width, 2);
  const forged = Buffer.alloc(50);
  forged.set([255, 216, 255]);
  await assert.rejects(replacementPreview(forged, 'image/jpeg', forged.length));
});
test('HEIC preview conversion with offline generated fixture', async t => {
  let fixture: Buffer;
  try {
    fixture = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).heif({ compression: 'hevc' }).toBuffer();
  } catch {
    t.skip('The offline sharp/libvips build has no HEVC encoder; no HEIC fixture can be generated without downloading one.');
    return;
  }
  const converted = await replacementPreview(fixture, 'image/heic', fixture.length);
  assert.equal((await sharp(converted).metadata()).format, 'jpeg');
});
