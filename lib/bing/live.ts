import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { bingJson } from './client';
import { bingWebmasterApiKey } from './flags';
import { enqueueBingContinuation } from './queue';
import { runBingCron, runBingQueueMessage, syncCronGate, type BingCronResult, type BingRunDeps } from './run';
import { readBingSite } from './sync';
import { createBingStore } from './store';

function liveDeps(apiKey: string): BingRunDeps {
    return {
        env: process.env,
        now: () => new Date(),
        newRunId: () => crypto.randomUUID(),
        fetchSites: () => bingJson({ method: 'GetUserSites', apiKey }),
        readSite: siteUrl => readBingSite(siteUrl, apiKey),
        store: createBingStore(createAdminClient(), process.env),
        publish: enqueueBingContinuation,
    };
}

/** Counts only. The Bing key, site list, and verification codes stay on the server. */
export async function handleBingCron(): Promise<BingCronResult> {
    try {
        const gate = syncCronGate(process.env);
        if (!gate.ok) return { skipped: true, reason: gate.reason };
        const apiKey = bingWebmasterApiKey(process.env);
        if (!apiKey) return { skipped: true, reason: 'missing_key' };
        const result = await runBingCron(liveDeps(apiKey));
        if ('error' in result) return { error: 'Bing sync will retry on the next run.' };
        if ('skipped' in result) return { skipped: true, reason: result.reason };
        return { enqueued: result.enqueued, continued: result.continued };
    } catch {
        return { error: 'Bing sync will retry on the next run.' };
    }
}

export async function handleBingQueue(message: unknown): Promise<void> {
    if (!syncCronGate(process.env).ok) return;
    const apiKey = bingWebmasterApiKey(process.env);
    if (!apiKey) return;
    try {
        await runBingQueueMessage(message, liveDeps(apiKey));
    } catch {
        throw new Error('Bing sync will retry');
    }
}
