import { createImageUpload } from '@/lib/approvals-v2/image-upload';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const POST = createImageUpload(true);
