export const MAX_GBP_PHOTOS = 10;

const HTTPS_PHOTO = /^https:\/\/\S+$/;
const STORED_PHOTO = /^(?:gbp-approvals|approval-assets)\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

export function isGbpMediaPath(path: unknown, httpsOnly = false): path is string {
    return typeof path === 'string' && path.length <= 500
        && (HTTPS_PHOTO.test(path) || (!httpsOnly && STORED_PHOTO.test(path)));
}

export function parseGbpPhotoPaths(value: unknown, httpsOnly = false): string[] | null {
    if (!Array.isArray(value) || value.length > MAX_GBP_PHOTOS) return null;
    return value.every(path => isGbpMediaPath(path, httpsOnly)) ? value : null;
}

/** Read new versions and legacy projections with the same ordering. */
export function versionPhotoPaths(paths?: readonly string[] | null, primary?: string | null): readonly string[] {
    return paths ?? (primary ? [primary] : []);
}
