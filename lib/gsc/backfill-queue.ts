import { send } from '@vercel/queue';
import { BACKFILL_QUEUE_TOPIC, type BackfillQueueMessage } from './backfill';

export async function enqueueGscBackfillContinuation(message: BackfillQueueMessage & {
    delaySeconds: number;
    idempotencyKey: string;
    retentionSeconds: number;
}): Promise<void> {
    await send(BACKFILL_QUEUE_TOPIC, {
        runId: message.runId,
        chain: message.chain,
    }, {
        delaySeconds: message.delaySeconds,
        idempotencyKey: message.idempotencyKey,
        retentionSeconds: message.retentionSeconds,
    });
}
