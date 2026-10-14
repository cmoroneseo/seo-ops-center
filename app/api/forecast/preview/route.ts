import { forecastPreviewGet } from '@/lib/forecast/wire';

export const dynamic = 'force-dynamic';

/** GET /api/forecast/preview — owner/admin preview. Does not send anything. */
export const GET = forecastPreviewGet;
