import { forecastUndoPost } from '@/lib/forecast/wire';

export const dynamic = 'force-dynamic';

/** POST /api/forecast/undo — owner/admin undo of the latest sync. */
export const POST = forecastUndoPost;
