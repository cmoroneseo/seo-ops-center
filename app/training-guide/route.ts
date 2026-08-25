import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildEmbeddedTrainingGuide } from '@/lib/training-guide';

export async function GET() {
    const source = await readFile(join(process.cwd(), 'content/training/seo-playbook-2026-full.html'), 'utf8');
    return new Response(buildEmbeddedTrainingGuide(source), {
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, max-age=0, must-revalidate',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; frame-ancestors 'self';",
            'X-Content-Type-Options': 'nosniff',
        },
    });
}
