import sharp from 'sharp';

export const replacementTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export function replacementMagic(bytes: Uint8Array): string | null {
  if (bytes.length < 12 || bytes.length > 15728640) return null;
  const buffer = Buffer.from(bytes);
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brands = buffer.toString('ascii', 8, Math.min(buffer.length, 40));
    if (/heic|heix|hevc|hevx/.test(brands)) return 'image/heic';
    if (/mif1|msf1/.test(brands)) return 'image/heif';
  }
  return null;
}
export async function replacementPreview(bytes: Uint8Array, type: string, size: number): Promise<Buffer> {
  const detected = replacementMagic(bytes);
  if (size !== bytes.length || !detected || (detected !== type && !([detected, type].every(value => ['image/heic', 'image/heif'].includes(value))))) throw new Error('The file type does not match the image.');
  let input = Buffer.from(bytes);
  if (detected === 'image/heic' || detected === 'image/heif') {
    const convert = (await import('heic-convert')).default;
    input = Buffer.from(await convert({ buffer: input, format: 'JPEG', quality: 0.85 }));
  }
  return sharp(input, { limitInputPixels: 40000000 }).timeout({ seconds: 15 }).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}
