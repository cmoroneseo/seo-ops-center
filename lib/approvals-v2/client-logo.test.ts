import assert from 'node:assert/strict';
import test from 'node:test';
import { safeClientLogoUrl } from './client-logo';

test('client logos must use the configured public bucket origin and path', () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
  const logo = 'https://project.supabase.co/storage/v1/object/public/client-logos/client.png';
  try {
    assert.equal(safeClientLogoUrl(logo), logo);
    for (const url of [null, '', logo.replace('project.', 'other.'), logo.replace('client-logos', 'other-bucket'), logo.replace('https:', 'http:'), 'javascript:alert(1)', logo.replace('https://', 'https://user:pass@'), logo + 'x'.repeat(1000), logo.replace('client.png', '../other-bucket/client.png'), logo.replace('.co/', '.co:8443/')]) {
      assert.equal(safeClientLogoUrl(url), null, String(url));
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'invalid';
    assert.equal(safeClientLogoUrl(logo), null);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  }
});
