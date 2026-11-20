import { createLiveBasecampTaskLinkHandler } from '@/lib/basecamp/task-link-live';

export const dynamic = 'force-dynamic';

export const GET = createLiveBasecampTaskLinkHandler('check');
export const POST = createLiveBasecampTaskLinkHandler('refresh');
