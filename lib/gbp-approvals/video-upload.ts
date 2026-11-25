import { GBP_VIDEO_MIME_TYPES, MAX_GBP_VIDEO_BYTES, videoMetadataError } from './video';

export const GBP_VIDEO_ACCEPT = 'video/mp4,video/quicktime,.mp4,.mov';
export const GBP_VIDEO_HINT = 'MP4 or MOV · up to 30s · max 75 MB · 720p+ · replaces photos on this post';

function waitForVideo(video: HTMLVideoElement, event: string, timeout: number) {
    return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            video.removeEventListener(event, ready);
            video.removeEventListener('error', failed);
        };
        const ready = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error('The browser could not read this video. Choose a playable MP4 or MOV.')); };
        const timer = setTimeout(failed, timeout);
        video.addEventListener(event, ready);
        video.addEventListener('error', failed);
    });
}

export async function prepareGbpVideo(file: File) {
    const extension = /\.(mp4|mov)$/i.exec(file.name)?.[1]?.toLowerCase();
    const contentType = extension === 'mov' ? 'video/quicktime' : 'video/mp4';
    if (!extension || (file.type && file.type !== 'application/octet-stream' && !GBP_VIDEO_MIME_TYPES.some(type => type === file.type))
        || file.size < 1 || file.size > MAX_GBP_VIDEO_BYTES) {
        throw new Error('Choose a nonempty MP4 or MOV video up to 75 MB.');
    }
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    try {
        const blobPrefix = `blob:${window.origin}/`;
        const objectId = url.startsWith(blobPrefix) ? url.slice(blobPrefix.length) : '';
        if (objectId.length !== 36 || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(objectId)) {
            throw new Error('The browser could not create a local video preview.');
        }
        const loaded = waitForVideo(video, 'loadedmetadata', 15000);
        video.setAttribute('src', `${blobPrefix}${encodeURIComponent(objectId)}`);
        await loaded;
        const metadata = { durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight };
        const error = videoMetadataError(metadata);
        if (error) throw new Error(error);
        let poster: Blob | null = null;
        try {
            if (video.readyState < 2) await waitForVideo(video, 'loadeddata', 1000);
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, 960 / Math.max(metadata.width, metadata.height));
            canvas.width = Math.round(metadata.width * scale);
            canvas.height = Math.round(metadata.height * scale);
            const context = canvas.getContext('2d');
            if (context) {
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                poster = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
            }
        } catch {
            // Some browsers can read metadata without decoding a poster frame.
        }
        return { file, contentType, metadata, poster };
    } finally {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
    }
}

export async function uploadGbpVideo(requestId: string, itemId: string, prepared: Awaited<ReturnType<typeof prepareGbpVideo>>) {
    const endpoint = `/api/approval-requests/${requestId}/assets`;
    async function asset(body: Record<string, unknown>) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId, ...body }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Video upload unavailable.');
        return result;
    }
    async function upload(file: Blob, kind: 'video' | 'video_poster', contentType: string, fields = {}) {
        const { objectKey, signedUrl } = await asset({ kind, contentType, size: file.size, ...fields });
        const response = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
        if (!response.ok) throw new Error('Video upload failed. Try again.');
        return objectKey as string;
    }
    const path = await upload(prepared.file, 'video', prepared.contentType, prepared.metadata);
    const { videoUrl } = await asset({ action: 'verify-video', objectKey: path });
    let posterPath: string | null = null;
    let posterSrc: string | null = null;
    if (prepared.poster) {
        try {
            const key = await upload(prepared.poster, 'video_poster', 'image/jpeg');
            const { assetUrl } = await asset({ objectKey: key });
            posterPath = key;
            posterSrc = assetUrl;
        } catch {
            // The verified video can still be saved without its optional poster.
        }
    }
    return { path, src: videoUrl as string, posterPath, posterSrc };
}
