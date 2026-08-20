import { createHash, timingSafeEqual } from 'node:crypto';

function digest(value: string) {
    return createHash('sha256').update(value, 'utf8').digest();
}

export function isAuthorizedBasecampWebhook(
    request: Request,
    configuredSecret: string | undefined,
) {
    const presentedSecret = request.headers.get('x-basecamp-webhook-secret');
    if (!configuredSecret || !presentedSecret) return false;
    return timingSafeEqual(digest(presentedSecret), digest(configuredSecret));
}
