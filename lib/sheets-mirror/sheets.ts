import { INFO_TAB, ROADMAP_TAB, TASKS_TAB, type MirrorTab } from './model';

export function assertAppSheetTarget(target: string, kind: 'title' | 'range' = 'title'): void {
    const pattern = kind === 'title' ? /^App – [\w ()-]+$/u : /^'App – [\w ()-]+'(?:!A1)?$/u;
    if (target !== target.trim() || !pattern.test(target)) throw new Error('Sheet writes require an App – tab');
}

interface SheetProperties {
    sheetId: number;
    title: string;
    gridProperties?: { rowCount?: number; columnCount?: number };
}

interface SheetsDeps {
    fetch: typeof fetch;
    getToken: () => Promise<string>;
    serviceAccountEmail: string;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
    now?: () => number;
}

function retryAfter(header: string | null, now: number): number {
    if (!header) return 0;
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    return Math.max(0, Date.parse(header) - now) || 0;
}

export async function writeMirror(sheetId: string, tabs: MirrorTab[], deps: SheetsDeps): Promise<void> {
    const allowedTabs: string[] = [ROADMAP_TAB, TASKS_TAB, INFO_TAB];
    for (const { title } of tabs) {
        assertAppSheetTarget(title);
        if (!allowedTabs.includes(title)) throw new Error('Unrecognized sheet mirror tab');
    }
    const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`;
    const token = await deps.getToken();
    const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));

    async function request(
        path: string, body?: object, targets: string[] = [], kind: 'title' | 'range' = 'title',
    ) {
        if (body) {
            if (!targets.length) throw new Error('Sheet writes require a target');
            targets.forEach(target => assertAppSheetTarget(target, kind));
        }
        for (let attempt = 0; ; attempt++) {
            const response = await deps.fetch(endpoint + path, {
                method: body ? 'POST' : 'GET',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined,
            });
            if (response.ok) return response;
            if (response.status === 403) throw new Error(`Share the sheet with ${deps.serviceAccountEmail} as Editor`);
            if (response.status === 404) throw new Error('Sheet not found');
            if (attempt === 4 || (response.status !== 429 && response.status < 500)) {
                throw new Error(`Google Sheets returned HTTP ${response.status}`);
            }
            const delay = 1000 * 2 ** attempt * (1 + (deps.random ?? Math.random)() / 4);
            await sleep(Math.max(delay, retryAfter(response.headers.get('Retry-After'), (deps.now ?? Date.now)())));
        }
    }

    const response = await request('?fields=sheets.properties');
    const metadata = await response.json() as { sheets?: { properties: SheetProperties }[] };
    const sheets = new Map(metadata.sheets?.map(({ properties }) => [properties.title, properties]));
    const operations: object[] = [];
    const targets: string[] = [];
    for (const { title, rows } of tabs) {
        const current = sheets.get(title);
        const rowCount = Math.max(2, rows.length, current?.gridProperties?.rowCount ?? 0);
        const columnCount = rows.reduce((count, row) => Math.max(count, row.length), current?.gridProperties?.columnCount ?? 1);
        const gridProperties = { frozenRowCount: 1, rowCount, columnCount };
        targets.push(title);
        if (!current) {
            operations.push({ addSheet: { properties: { title, gridProperties } } });
            continue;
        }
        const snapshotTitle = `${title} (prev)`;
        targets.push(snapshotTitle);
        const oldSnapshot = sheets.get(snapshotTitle);
        if (oldSnapshot) operations.push({ deleteSheet: { sheetId: oldSnapshot.sheetId } });
        operations.push(
            { duplicateSheet: { sourceSheetId: current.sheetId, newSheetName: snapshotTitle } },
            { updateSheetProperties: {
                properties: { sheetId: current.sheetId, gridProperties },
                fields: 'gridProperties(frozenRowCount,rowCount,columnCount)',
            } },
        );
    }
    await request(':batchUpdate', { requests: operations }, targets);

    const ranges = tabs.map(({ title }) => `'${title}'`);
    await request('/values:batchClear', { ranges }, ranges, 'range');
    const data = tabs.map(({ rows }, index) => ({ range: `${ranges[index]}!A1`, values: rows }));
    await request('/values:batchUpdate', { valueInputOption: 'RAW', data }, data.map(row => row.range), 'range');
}
