import type { PerformanceModel } from '../workspace-canvas/project';
import { dateOffset } from './history';

/** Historical reports are not stale merely because their dates are old. */
export function performanceHealth(model: PerformanceModel, now = new Date()): 'reconnect' | 'interrupted' | 'stale' | null {
    if (model.connectionHealth === 'reconnect' || model.connectionHealth === 'interrupted') return model.connectionHealth;
    const lastSync = model.lastSync ? Date.parse(model.lastSync) : NaN;
    const recentWindow = (model.points.at(-1)?.date ?? '') >= dateOffset(model.availableThrough, -3);
    if (recentWindow && Number.isFinite(lastSync) && now.getTime() - lastSync > 72 * 3600000) return 'stale';
    return null;
}
