import { forecastSyncPost } from '@/lib/forecast/wire';

export const dynamic = 'force-dynamic';

/** POST /api/forecast/sync — owner/admin manual send. No cron calls this. */
export const POST = forecastSyncPost;
