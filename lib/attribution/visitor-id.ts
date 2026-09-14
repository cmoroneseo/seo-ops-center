import { createHmac } from 'crypto';

export function makeVisitorId(
    ip: string,
    ua: string,
    siteId: string,
    secret: string,
    date = new Date().toISOString().slice(0, 10),
): string {
    return createHmac('sha256', secret).update(`${siteId}:${date}:${ip}:${ua}`).digest('hex').slice(0, 16);
}
