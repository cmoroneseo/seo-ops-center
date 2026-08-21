import type { TimerAttempt } from './types';

export function timerSwitchPrompt(from: TimerAttempt, toTitle: string): string {
    return `Pause “${from.taskTitle ?? from.clientName}” and start “${toTitle}”?`;
}
