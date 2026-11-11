import { dailyRateText } from './impact';
import { CHANGE_TYPE_LABEL, KPI_LABEL, VERDICT_LABEL, type ImpactModel, type SeoChange } from './types';
import { formatPt } from './time';

function cell(value: string | number | null | undefined): string {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

export function impactCsv(change: SeoChange, impact: ImpactModel): string {
    const lines: string[][] = [
        ['Change', change.title],
        ['Type', CHANGE_TYPE_LABEL[change.changeType]],
        ['Live', formatPt(change.liveAt)],
        ['Approved by', change.approvedByName],
        ['KPI', KPI_LABEL[change.kpi]],
        ['Pages', change.pages.map(page => page.url).join(' ')],
        ['Verdict', VERDICT_LABEL[impact.headline.verdict]],
        ['Note', impact.headline.note],
        ['Causation', impact.causation],
        [],
        ['Checkpoint', 'Ready', 'Verdict', 'Estimate', 'Page', 'Control'],
    ];
    for (const checkpoint of impact.checkpoints) {
        lines.push([
            String(checkpoint.days),
            checkpoint.ready ? 'yes' : 'no',
            VERDICT_LABEL[checkpoint.verdict],
            checkpoint.estimate ? 'estimate' : '',
            checkpoint.ready ? dailyRateText(change.kpi, impact.baseline, checkpoint.page) : '',
            checkpoint.controlMode,
        ]);
    }
    lines.push([]);
    lines.push(['Query', 'Before clicks', 'After clicks', 'Before impressions', 'After impressions', 'Before position', 'After position']);
    for (const query of impact.queries) {
        lines.push([
            query.query,
            String(query.beforeClicks),
            String(query.afterClicks),
            String(query.beforeImpressions),
            String(query.afterImpressions),
            query.beforePosition == null ? '' : String(query.beforePosition),
            query.afterPosition == null ? '' : String(query.afterPosition),
        ]);
    }
    return lines.map(line => line.map(cell).join(',')).join('\n');
}
