import { send } from '@vercel/queue';
import { GA4_QUEUE_TOPIC, type Ga4QueueSend } from './backfill';

/** The body is a run id, a chain number, and a kind. Tokens are not queued. */
export async function enqueueGa4Continuation(message: Ga4QueueSend): Promise<void> {
    await send(GA4_QUEUE_TOPIC, {
        runId: message.runId,
        chain: message.chain,
        kind: message.kind,
    }, {
        delaySeconds: message.delaySeconds,
        idempotencyKey: message.idempotencyKey,
        retentionSeconds: message.retentionSeconds,
    });
}
