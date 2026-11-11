import { VERDICT_THRESHOLDS } from './thresholds';
import type { ControlMode, Kpi, MetricRead, RateDelta, Verdict } from './types';
import { KPI_LABEL } from './types';

export interface Classified {
    verdict: Verdict;
    note: string;
    estimate: boolean;
    lowData: boolean;
    lift: number | null;
}

export function isLowData(kpi: Kpi, before: MetricRead, after: MetricRead): boolean {
    if (!before.measured || !after.measured) return false;
    if (kpi === 'organic_sessions') {
        const floor = VERDICT_THRESHOLDS.lowDataSessions;
        return (before.organicSessions ?? 0) < floor || (after.organicSessions ?? 0) < floor;
    }
    if (kpi === 'key_events') {
        const floor = VERDICT_THRESHOLDS.lowDataKeyEvents;
        return (before.keyEvents ?? 0) < floor || (after.keyEvents ?? 0) < floor;
    }
    if (before.impressions < VERDICT_THRESHOLDS.lowDataImpressions || after.impressions < VERDICT_THRESHOLDS.lowDataImpressions) {
        return true;
    }
    if (kpi === 'clicks') {
        return before.clicks < VERDICT_THRESHOLDS.lowDataClicks || after.clicks < VERDICT_THRESHOLDS.lowDataClicks;
    }
    return false;
}

function withEstimate(note: string, estimate: boolean): string {
    if (!estimate) return note;
    return note.endsWith('.') ? `${note.slice(0, -1)}. Estimate.` : `${note} Estimate.`;
}

/**
 * One checkpoint. Callers only pass `ready` when the after window is final
 * and covered, and `baselineReady` when the prior 28 days are covered.
 */
export function classifyCheckpoint(input: {
    kpi: Kpi;
    ready: boolean;
    baselineReady: boolean;
    connected: boolean;
    partial: boolean;
    lowData: boolean;
    page: RateDelta;
    control: RateDelta | null;
    controlMode: ControlMode;
    controlUnreliable: boolean;
    lagNote: string;
}): Classified {
    const estimate = input.lowData || input.partial || input.controlUnreliable;
    const name = KPI_LABEL[input.kpi].toLowerCase();

    if (!input.connected) {
        const note = input.kpi === 'organic_sessions' || input.kpi === 'key_events'
            ? "Analytics isn't connected."
            : "Search Console isn't connected.";
        return { verdict: 'too_early', note, estimate: false, lowData: false, lift: null };
    }
    if (!input.baselineReady) {
        return {
            verdict: 'too_early',
            note: 'The 28 days before this change are not stored yet.',
            estimate: false,
            lowData: false,
            lift: null,
        };
    }
    if (!input.ready) {
        return {
            verdict: 'too_early',
            note: `Too early. The first read waits for 7 final days. ${input.lagNote}`,
            estimate: false,
            lowData: false,
            lift: null,
        };
    }

    if (input.kpi === 'avg_position' && input.page.absolute != null && Math.abs(input.page.absolute) < VERDICT_THRESHOLDS.positionNoise) {
        return {
            verdict: 'flat',
            note: withEstimate('Average position moved less than 1.', estimate),
            estimate,
            lowData: input.lowData,
            lift: null,
        };
    }

    if (input.page.fromZero) {
        const controlRose = (input.control?.helpful ?? 0) >= VERDICT_THRESHOLDS.controlLift || input.control?.fromZero === true;
        if (input.controlMode !== 'none' && controlRose) {
            return {
                verdict: 'flat',
                note: withEstimate('Up from zero, and the rest of the site rose too.', estimate),
                estimate,
                lowData: input.lowData,
                lift: null,
            };
        }
        return {
            verdict: 'improved',
            note: withEstimate(`Up from zero on ${name}. The percent isn't meaningful.`, true),
            estimate: true,
            lowData: input.lowData,
            lift: null,
        };
    }

    const pageMove = input.page.helpful;
    if (pageMove == null) {
        return {
            verdict: 'too_early',
            note: `No ${name} number in this window.`,
            estimate: false,
            lowData: input.lowData,
            lift: null,
        };
    }

    if (input.controlMode === 'none' || input.control?.helpful == null) {
        const band = VERDICT_THRESHOLDS.pageBand;
        const verdict: Verdict = pageMove >= band ? 'improved' : pageMove <= -band ? 'declined' : 'flat';
        const note = verdict === 'flat'
            ? `No control. ${capitalize(name)} stayed inside 15%.`
            : `No control. ${capitalize(name)} ${verdict === 'improved' ? 'rose' : 'fell'} at least 15% on the page alone.`;
        return { verdict, note: withEstimate(note, estimate), estimate, lowData: input.lowData, lift: null };
    }

    const lift = pageMove - input.control.helpful;
    const gate = VERDICT_THRESHOLDS.controlLift;
    let verdict: Verdict = 'flat';
    if (lift >= gate && pageMove > 0) verdict = 'improved';
    else if (lift <= -gate && pageMove < 0) verdict = 'declined';

    let note: string;
    if (verdict === 'improved') note = `${capitalize(name)} beat the rest of the site.`;
    else if (verdict === 'declined') note = `${capitalize(name)} fell more than the rest of the site.`;
    else if (input.control.helpful > 0 && pageMove > 0) note = 'The rest of the site moved with it.';
    else note = `${capitalize(name)} stayed inside the band.`;

    return {
        verdict,
        note: withEstimate(note, estimate),
        estimate,
        lowData: input.lowData,
        lift,
    };
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

export function nextStep(changeType: string, verdict: Verdict): string {
    if (verdict === 'too_early') return 'Wait for the 7-day read before changing it again.';
    if (verdict === 'declined') {
        if (changeType === 'h1') return 'Revert the H1, then test a smaller wording change.';
        return 'Revert this change, then test one smaller edit.';
    }
    if (verdict === 'improved') {
        if (changeType === 'h1') return 'Leave the H1. Next test is the title or the line under it, one at a time.';
        return 'Leave it. Check again at the next checkpoint before stacking another edit.';
    }
    if (changeType === 'h1') return 'The H1 did not separate from the rest of the site. Next test: the hero line, not another H1.';
    if (changeType === 'title') return 'The title did not separate from the rest of the site. Next test: the H1, not another title.';
    return 'It did not separate from the rest of the site. Next test: one tighter edit, not a bundle.';
}
