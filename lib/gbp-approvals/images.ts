const MAX_BYTES = 10 * 1024 * 1024;

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'gif';

const TYPES: Record<ImageKind, string> = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
};

export function imageContentType(kind: ImageKind): string {
    return TYPES[kind];
}

/** True when the bytes are a JPEG, PNG, WEBP, or GIF and nothing else. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
    if (bytes.byteLength < 12 || bytes.byteLength > MAX_BYTES) return null;
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif';
    if (
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) return 'webp';
    return null;
}

const KEY = /^gbp-approvals\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/;

/** The object key is chosen by the server and can only name this request. */
export function uploadKeyMatches(requestId: string, objectKey: string): boolean {
    const match = KEY.exec(objectKey);
    return Boolean(match && match[1] === requestId);
}
