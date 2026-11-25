import { z } from 'zod';
import { isGbpMediaPath, parseGbpPhotoPaths } from './photos';

export const MAX_GBP_VIDEO_BYTES = 75 * 1024 * 1024;
export const MAX_GBP_VIDEO_DURATION_SECONDS = 30;
export const MIN_GBP_VIDEO_RESOLUTION = 720;
export const GBP_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime'] as const;

export function parseGbpVideoPath(value: unknown, httpsOnly = false): string | null {
    return isGbpMediaPath(value, httpsOnly) ? value : null;
}

export function gbpMediaError(item: {
    photoPath?: unknown;
    photoPaths?: unknown;
    videoPath?: unknown;
    videoPosterPath?: unknown;
}, { page = false, httpsOnly = false } = {}): string | null {
    if (item.photoPaths !== undefined && (page || !parseGbpPhotoPaths(item.photoPaths, httpsOnly))) {
        return 'A GBP post can include up to 10 valid photos.';
    }
    if (item.videoPath != null) {
        if (page || !parseGbpVideoPath(item.videoPath, httpsOnly)) return 'Choose a valid GBP video.';
        if (item.photoPath != null || (Array.isArray(item.photoPaths) && item.photoPaths.length)) {
            return 'Choose up to 10 photos or one video per GBP post.';
        }
    }
    if (item.videoPosterPath != null) {
        if (page || !item.videoPath || !parseGbpVideoPath(item.videoPosterPath, httpsOnly)) return 'A video poster requires a valid GBP video.';
        if (item.videoPosterPath === item.videoPath) return 'Choose a separate image for the video poster.';
    }
    return null;
}

export const gbpPostMediaSchema = z.object({
    photoPath: z.unknown().optional(),
    photoPaths: z.unknown().optional(),
    videoPath: z.unknown().optional(),
    videoPosterPath: z.unknown().optional(),
}).superRefine((media, context) => {
    const error = gbpMediaError(media);
    if (error) context.addIssue({ code: 'custom', message: error });
});

export const gbpVideoMetadataSchema = z.object({
    durationSeconds: z.number().positive().max(MAX_GBP_VIDEO_DURATION_SECONDS),
    width: z.number().int().min(MIN_GBP_VIDEO_RESOLUTION),
    height: z.number().int().min(MIN_GBP_VIDEO_RESOLUTION),
});
type VideoMetadata = z.infer<typeof gbpVideoMetadataSchema>;

export function videoMetadataError(metadata: VideoMetadata): string | null {
    if (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds <= 0) return 'The video duration could not be read.';
    if (metadata.durationSeconds > MAX_GBP_VIDEO_DURATION_SECONDS) return 'Choose a video up to 30 seconds long.';
    if (!gbpVideoMetadataSchema.safeParse(metadata).success) return 'Choose a video with resolution of 720p or higher.';
    return null;
}

type Box = { type: string; start: number; end: number };
type Inspection = { ok: true } & VideoMetadata | { ok: false; error: string };
const mp4Brand = /^(?:isom|iso[2-9]|mp4[12]|avc1|dash|M4V |qt  |MSNV)$/;

export function inspectMp4VideoBuffer(bytes: Uint8Array): Inspection {
    if (!bytes.byteLength || bytes.byteLength > MAX_GBP_VIDEO_BYTES) {
        return { ok: false, error: 'Choose a nonempty video up to 75 MB.' };
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const typeAt = (offset: number) => String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3),
    );
    let budget = 100_000;
    function* boxes(start: number, end: number): Generator<Box> {
        while (start < end) {
            if (end - start < 8 || --budget < 0) throw new Error('Invalid box header');
            const type = typeAt(start + 4);
            let size = view.getUint32(start);
            let header = 8;
            if (size === 1) {
                header = 16;
                if (end - start < header) throw new Error('Incomplete extended size');
                const extended = view.getBigUint64(start + 8);
                if (extended > BigInt(end - start)) throw new Error('Invalid extended size');
                size = Number(extended);
            } else if (size === 0) {
                size = end - start;
            }
            if (size < header || size > end - start) throw new Error('Invalid box size');
            yield { type, start: start + header, end: start + size };
            start += size;
        }
    }

    try {
        let movie: Box | undefined;
        let validBrand: boolean | undefined;
        let hasMediaData = false;
        for (const box of boxes(0, view.byteLength)) {
            if (box.type === 'ftyp') {
                const size = box.end - box.start;
                if (validBrand !== undefined || size < 8 || size % 4 || size > 4096) throw new Error('Invalid ftyp');
                validBrand = mp4Brand.test(typeAt(box.start));
                for (let offset = box.start + 8; !validBrand && offset + 4 <= box.end; offset += 4) {
                    validBrand = mp4Brand.test(typeAt(offset));
                }
            }
            if (box.type === 'moov') {
                if (movie) throw new Error('Duplicate movie box');
                movie = box;
            }
            if (box.type === 'mdat' && box.end > box.start) hasMediaData = true;
        }
        if (!movie || !validBrand || !hasMediaData) throw new Error('Missing MP4 or MOV data');

        let durationSeconds: number | undefined;
        let width = 0;
        let height = 0;
        for (const child of boxes(movie.start, movie.end)) {
            if (child.type === 'mvhd') {
                if (durationSeconds !== undefined || child.start === child.end) throw new Error('Invalid movie header');
                const version = view.getUint8(child.start);
                if (version > 1 || child.end - child.start < (version === 1 ? 112 : 100)) throw new Error('Invalid movie header');
                const timescale = view.getUint32(child.start + (version === 1 ? 20 : 12));
                const duration = version === 1 ? view.getBigUint64(child.start + 24) : BigInt(view.getUint32(child.start + 16));
                durationSeconds = timescale ? Number(duration) / timescale : 0;
            } else if (child.type === 'trak') {
                let header: Box | undefined;
                let isVideo = false;
                for (const track of boxes(child.start, child.end)) {
                    if (track.type === 'tkhd') header = track;
                    if (track.type === 'mdia') {
                        for (const media of boxes(track.start, track.end)) {
                            if (media.type === 'hdlr') {
                                if (media.end - media.start < 24) throw new Error('Invalid media handler');
                                isVideo = typeAt(media.start + 8) === 'vide';
                            }
                        }
                    }
                }
                if (!isVideo) continue;
                if (!header || header.start === header.end) throw new Error('Missing video track header');
                const version = view.getUint8(header.start);
                const dimensions = header.start + (version === 1 ? 88 : 76);
                if (version > 1 || header.end < dimensions + 8) throw new Error('Invalid track header');
                const trackWidth = Math.floor(view.getUint32(dimensions) / 65536);
                const trackHeight = Math.floor(view.getUint32(dimensions + 4) / 65536);
                if (!trackWidth || !trackHeight) throw new Error('Missing video dimensions');
                if (Math.min(trackWidth, trackHeight) > Math.min(width, height)) {
                    width = trackWidth;
                    height = trackHeight;
                }
            }
        }
        if (!width || !height) return { ok: false, error: 'The file does not contain a readable video track.' };
        const metadata = { durationSeconds: durationSeconds ?? 0, width, height };
        const error = videoMetadataError(metadata);
        return error ? { ok: false, error } : { ok: true, ...metadata };
    } catch {
        return { ok: false, error: 'The file is not a readable MP4 or MOV video.' };
    }
}
