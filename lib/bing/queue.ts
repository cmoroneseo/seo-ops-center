import { send } from '@vercel/queue';
import { BING_QUEUE_TOPIC, type BingQueueSend } from './sync';

/** The body is a run id and a chain number. The API key is not queued. */
export async function enqueueBingContinuation(message: BingQueueSend): Promise<void> {
    await send(BING_QUEUE_TOPIC, {
        runId: message.runId,
        chain: message.chain,
    }, {
        delaySeconds: message.delaySeconds,
        idempotencyKey: message.idempotencyKey,
        retentionSeconds: message.retentionSeconds,
    });
}
