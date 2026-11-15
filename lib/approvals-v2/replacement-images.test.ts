import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
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
test('HEIC preview conversion with a committed fixture', async () => {
  // 16x12 HEIC generated with libheif (pillow-heif); sharp's prebuilt libvips cannot encode HEVC.
  const fixture = readFileSync(new URL('./fixtures/tiny.heic', import.meta.url));
  assert.equal(replacementMagic(fixture), 'image/heic');
  const converted = await replacementPreview(fixture, 'image/heic', fixture.length);
  const metadata = await sharp(converted).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 16);
});
