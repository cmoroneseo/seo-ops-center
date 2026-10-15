import { postGoogleTokenEncryption } from '@/lib/security/google-token-backfill-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request) {
    return postGoogleTokenEncryption(request);
}
