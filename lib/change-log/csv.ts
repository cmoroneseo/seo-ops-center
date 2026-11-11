import { controlModeLabel } from './control';
import { dailyRateText } from './impact';
import { CHANGE_TYPE_LABEL, KPI_LABEL, resultLabel, type ImpactModel, type SeoChange } from './types';
import { formatWentLive } from './time';

function cell(value: string | number | null | undefined): string {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

export function impactCsv(change: SeoChange, impact: ImpactModel): string {
    const lines: string[][] = [
        ['Change', change.title],
        ['Type', CHANGE_TYPE_LABEL[change.changeType]],
        ['Went live', formatWentLive(change.liveAt)],
        ['Approved by', change.approvedByName],
        ["What we're watching", KPI_LABEL[change.kpi]],
        ['Pages', change.pages.map(page => page.url).join(' ')],
        ['Result', resultLabel(impact.headline.verdict, impact.headline.estimate)],
        ['Note', impact.headline.note],
        ['Keep in mind', impact.causation],
        [],
        ['Check', 'Ready', 'Result', 'Early estimate', 'This page', 'Rest of the site'],
    ];
    for (const checkpoint of impact.checkpoints) {
        lines.push([
            `${checkpoint.days}-day check`,
            checkpoint.ready ? 'yes' : 'no',
            resultLabel(checkpoint.verdict, checkpoint.estimate),
            checkpoint.estimate ? 'Early estimate' : '',
            checkpoint.ready ? dailyRateText(change.kpi, impact.baseline, checkpoint.page) : 'Not ready yet',
            controlModeLabel(checkpoint.controlMode),
        ]);
    }
    lines.push([]);
    lines.push(['Search term', 'Clicks from Google before', 'Clicks from Google after', 'Times shown in Google before', 'Times shown in Google after', 'Average Google position before', 'Average Google position after']);
    for (const query of impact.queries) {
        lines.push([
            query.query,
            query.beforeClicks == null ? '' : String(query.beforeClicks),
            query.afterClicks == null ? '' : String(query.afterClicks),
            query.beforeImpressions == null ? '' : String(query.beforeImpressions),
            query.afterImpressions == null ? '' : String(query.afterImpressions),
            query.beforePosition == null ? '' : String(query.beforePosition),
            query.afterPosition == null ? '' : String(query.afterPosition),
        ]);
    }
    return lines.map(line => line.map(cell).join(',')).join('\n');
}
