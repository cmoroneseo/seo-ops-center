export const previewColumns = [
    'approve', 'action', 'target_table', 'client_name', 'client_id', 'sheet_id', 'sheet_tab',
    'sheet_row', 'title', 'status', 'roadmap_phase', 'month_label', 'step_key', 'category',
    'description', 'import_key', 'possible_duplicate_of', 'match_score', 'covered_by',
    'needs_new_plan', 'notes',
] as const;

export type PreviewRow = Record<typeof previewColumns[number], string>;

export function parseCsv(csv: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    let closed = false;
    const finishCell = () => {
        row.push(cell);
        cell = '';
        closed = false;
    };

    csv = csv.replace(/^\uFEFF/, '');
    for (let index = 0; index < csv.length; index++) {
        const char = csv[index];
        if (quoted) {
            if (char === '"' && csv[index + 1] === '"') {
                cell += '"';
                index++;
            } else if (char === '"') {
                quoted = false;
                closed = true;
            } else {
                cell += char;
            }
        } else if (char === ',') {
            finishCell();
        } else if (char === '\n' || char === '\r') {
            finishCell();
            rows.push(row);
            row = [];
            if (char === '\r' && csv[index + 1] === '\n') index++;
        } else if (char === '"' && !cell && !closed) {
            quoted = true;
        } else if (char === '"' || closed) {
            throw new Error('Malformed CSV field');
        } else {
            cell += char;
        }
    }
    if (quoted) throw new Error('Unclosed quoted CSV field');
    if (row.length || cell || closed) {
        finishCell();
        rows.push(row);
    }
    return rows;
}

const unsafePrefix = /^[\s]*[=+\-@']/;

function escapeCell(value: string) {
    const safe = unsafePrefix.test(value) ? "'" + value : value;
    return /[",\r\n]/.test(safe) ? '"' + safe.replaceAll('"', '""') + '"' : safe;
}

export function toPreviewCsv(rows: PreviewRow[]): string {
    return [previewColumns.join(','), ...rows.map(row =>
        previewColumns.map(column => escapeCell(row[column])).join(',')
    )].join('\r\n') + '\r\n';
}

export function parsePreviewCsv(csv: string): PreviewRow[] {
    const [header, ...rows] = parseCsv(csv);
    // Previously generated previews can still be approved and imported.
    const importColumns = header?.filter(column => column !== 'stage');
    if (!header || importColumns?.length !== previewColumns.length
        || header.length - importColumns.length > 1
        || previewColumns.some(column => !importColumns.includes(column))) {
        throw new Error('Invalid preview CSV header');
    }
    return rows.flatMap((row, index) => {
        if (row.every(cell => !cell.trim())) return [];
        if (row.length !== header.length) throw new Error(`Invalid preview CSV record ${index + 2}`);
        return [Object.fromEntries(previewColumns.map(column => {
            const position = header.indexOf(column);
            const cell = row[position];
            return [column, cell.startsWith("'") && unsafePrefix.test(cell.slice(1)) ? cell.slice(1) : cell];
        })) as PreviewRow];
    });
}
