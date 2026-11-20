import 'server-only';

import { send } from '@vercel/queue';
import { getAccessToken, loadServiceAccountFromEnv, SHEETS_SCOPES } from '../google/service-account';
import { createAdminClient } from '../supabase/admin';
import { createMirrorStore } from './store';
import { writeMirror } from './sheets';
import { mirrorEnabled, MIRROR_OFF, MISSING_CREDENTIALS, runMirrorCron, runMirrorQueue, signMirrorMessage, syncClientSheet, verifyMirrorMessage, type MirrorMessage } from './run';

export function isMirrorEnabled() {
    return mirrorEnabled({ SHEETS_MIRROR_ENABLED: process.env.SHEETS_MIRROR_ENABLED });
}

export function liveMirrorStore() {
    return createMirrorStore(createAdminClient());
}

function syncDeps(credentials: NonNullable<ReturnType<typeof loadServiceAccountFromEnv>>) {
    return {
        enabled: true,
        store: liveMirrorStore(),
        now: () => new Date(),
        basecampAccountId: process.env.BASECAMP_ACCOUNT_ID,
        write: (sheetId: string, tabs: Parameters<typeof writeMirror>[1]) => writeMirror(sheetId, tabs, {
            fetch,
            serviceAccountEmail: credentials.clientEmail,
            async getToken() {
                try {
                    return await getAccessToken(credentials, SHEETS_SCOPES);
                } catch {
                    throw new Error('Could not authenticate the Google service account');
                }
            },
        }),
    };
}

async function publish(message: MirrorMessage) {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new Error('Missing CRON_SECRET');
    // The SDK can deliver the payload directly from the callback body.
    await send('client-sheet-mirror', signMirrorMessage(message, secret), {
        idempotencyKey: `${message.chainId}:${message.index}`,
    });
}

export async function handleMirrorCron() {
    if (!isMirrorEnabled()) return { skipped: true, reason: MIRROR_OFF };
    if (!loadServiceAccountFromEnv()) return { skipped: true, reason: MISSING_CREDENTIALS };
    return runMirrorCron({ enabled: true, listClients: () => liveMirrorStore().listClients(), publish });
}

export async function handleMirrorQueue(payload: unknown) {
    if (!isMirrorEnabled()) return;
    const message = verifyMirrorMessage(payload, process.env.CRON_SECRET);
    if (!message) return;
    const credentials = loadServiceAccountFromEnv();
    if (!credentials) return;
    await runMirrorQueue(message, {
        enabled: true,
        publish,
        sync: (clientId, runId) => syncClientSheet(clientId, { ...syncDeps(credentials), trigger: 'cron', runId }),
    });
}

export async function handleManualMirror(clientId: string, organizationId: string, userId: string) {
    const credentials = loadServiceAccountFromEnv();
    if (!credentials) return { status: 'unconfigured', error: MISSING_CREDENTIALS } as const;
    return syncClientSheet(clientId, {
        ...syncDeps(credentials), trigger: 'manual', organizationId, requestedBy: userId,
    });
}
