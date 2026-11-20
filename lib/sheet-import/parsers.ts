import { normalize } from './mapping';

function parseRows(grid: string[][], headerIndex: number, titleColumn: string, skipExamples: boolean) {
    const headers = grid[headerIndex]?.map(normalize) ?? [];
    if (headerIndex < 0 || !headers.includes(normalize(titleColumn))) {
        throw new Error(`Missing sheet header for "${titleColumn}"`);
    }

    return grid.slice(headerIndex + 1).flatMap((cells, index) => {
        const cell = (name: string) => cells[headers.indexOf(normalize(name))] ?? '';
        const title = cell(titleColumn).trim();
        if (!title || (skipExamples && /^example/i.test(title))) return [];
        return [{ row: headerIndex + index + 2, title, cell }];
    });
}

export function parseRoadmap(grid: string[][]) {
    return parseRows(grid, grid.findIndex(row => normalize(row[0] ?? '') === 'phase'), 'Initiative / Deliverable', false);
}

export function parseContentPlan(grid: string[][]) {
    return parseRows(grid, 0, 'Title', true);
}
