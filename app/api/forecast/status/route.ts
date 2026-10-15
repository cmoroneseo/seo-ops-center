import { forecastStatusGet } from '@/lib/forecast/wire';

export const dynamic = 'force-dynamic';

/** GET /api/forecast/status — owner/admin forecast column for one week. */
export const GET = forecastStatusGet;
