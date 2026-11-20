import { SEO_PLAN_LABEL } from '../marketing-plan-template';
import { previewColumns, type PreviewRow } from './csv';
import { buildImportKey, mapPhase, mapStatus, mapStepKey, tabs, type SheetTab } from './mapping';
import { parseContentPlan, parseRoadmap } from './parsers';

type ExistingItem = { id: string; title: string };

export interface ManifestClient {
    clientId: string;
    clientName: string;
    organizationId: string;
    marketingPlanId: string | null;
    launchDate: string | null;
    sheetId: string;
    tabs?: Partial<Record<SheetTab, string>>;
    rows: { tab: SheetTab; row: number; action: 'create' | 'skip'; coveredBy?: string; note?: string }[];
    existing: { planItems: ExistingItem[]; tasks: ExistingItem[] };
}

export type Manifest = { clients: ManifestClient[] };
export type Grids = Record<string, Partial<Record<SheetTab, string[][]>>>;

const stopwords = new Set('a an and are as at be by for from in is it of on or that the to with'.split(' '));

function titleTokens(title: string): string[] {
    return title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(token => token && !stopwords.has(token));
}

// Normalized Levenshtein similarity preserves word order as a second signal.
function sequenceRatio(left: string, right: string): number {
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i++) {
        const current = [i];
        for (let j = 1; j <= right.length; j++) {
            current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(left[i - 1] !== right[j - 1]));
        }
        previous = current;
    }
    return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function titleSimilarity(left: string, right: string): number {
    const leftTokens = titleTokens(left);
    const rightTokens = titleTokens(right);
    if (!leftTokens.length || !rightTokens.length) return 0;
    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);
    const union = new Set([...leftSet, ...rightSet]);
    const intersection = [...leftSet].filter(token => rightSet.has(token)).length;
    return (intersection / union.size + sequenceRatio(leftTokens.join(' '), rightTokens.join(' '))) / 2;
}

const contentColumns = [
    'Content Type', 'KW', 'Volume', 'KD', 'Due Date', 'Draft Link', 'Live Link',
    'Matching Product/Service', 'Internal Link', 'Month',
];

export function buildPreview(manifest: Manifest, grids: Grids): PreviewRow[] {
    return manifest.clients.flatMap(client => {
        const parsed = new Map(tabs.flatMap(tab => {
            if (!client.rows.some(selection => selection.tab === tab)) return [];
            const grid = grids[client.clientId]?.[tab];
            if (!grid) throw new Error(`Missing ${tab} export for client ${client.clientId}`);
            const rows = tab === 'Roadmap' ? parseRoadmap(grid) : parseContentPlan(grid);
            return [[tab, new Map(rows.map(row => [row.row, row]))] as const];
        }));

        return client.rows.map(selection => {
            const { tab, row, action, coveredBy, note } = selection;
            const importKey = buildImportKey(client.sheetId, tab, row);
            const source = parsed.get(tab)?.get(row);
            if (!source && action === 'create') throw new Error(`No importable entry at ${importKey}`);
            if (action !== 'create' && action !== 'skip') throw new Error(`Invalid action at ${importKey}`);
            const preview = Object.fromEntries(previewColumns.map(column => [column, ''])) as PreviewRow;
            const roadmap = tab === 'Roadmap';
            const target = roadmap ? 'marketing_plan_items' : 'tasks';
            const cell = (name: string) => source?.cell(name) ?? '';
            const monthLabel = cell(roadmap ? 'Target Month' : 'Month');
            const { phase } = mapPhase(monthLabel, client.launchDate);
            const description = roadmap
                ? [
                    phase === 'backlog' && monthLabel.trim() ? `Sheet: ${monthLabel}` : '',
                    cell('Why It Matters / Notes').trim(),
                    cell("What You'll Get").trim() ? `What You'll Get: ${cell("What You'll Get").trim()}` : '',
                ]
                : contentColumns.flatMap(name => cell(name).trim() ? [`${name}: ${cell(name).trim()}`] : []);
            description.push(`Imported from client sheet ${tab} row ${row}`);

            const notes = [note];
            if (action === 'skip' && coveredBy) notes.push(`likely covered by existing task ${coveredBy}`);
            const needsPlan = roadmap && client.marketingPlanId === null;
            if (needsPlan && action === 'create') notes.push(`Apply would create a marketing plan titled "${client.clientName} — ${SEO_PLAN_LABEL}"`);

            if (action === 'create') {
                for (const item of [...client.existing.planItems, ...client.existing.tasks]) {
                    const score = titleSimilarity(source?.title ?? '', item.title);
                    if (score >= 0.6 && score > Number(preview.match_score)) {
                        preview.possible_duplicate_of = item.id;
                        preview.match_score = String(score);
                    }
                }
            }

            return Object.assign(preview, {
                action, target_table: target, client_name: client.clientName, client_id: client.clientId,
                sheet_id: client.sheetId, sheet_tab: tab, sheet_row: String(row), title: source?.title ?? '',
                status: mapStatus(cell('Status'), target), roadmap_phase: roadmap ? phase : '',
                month_label: monthLabel, step_key: roadmap ? mapStepKey(cell('Category')) : '',
                category: roadmap ? '' : 'content', stage: roadmap ? '' : 'backlog',
                description: description.filter(Boolean).join('\n\n'), import_key: importKey,
                covered_by: coveredBy ?? '', needs_new_plan: needsPlan ? 'yes' : '',
                notes: notes.filter(Boolean).join('\n'),
            });
        });
    });
}
