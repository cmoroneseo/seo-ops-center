const sheetBaseUrl = 'https://docs.google.com/spreadsheets/d/';
const sheetLinkPattern = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{25,100})(?:[/?#].*)?$/;

type SheetLinkError = { ok: false; error: string };

export function parseSheetLink(input: string): { ok: true; url: string; sheetId: string } | SheetLinkError {
    const trimmed = input.trim();
    if (input.length > 500) {
        return { ok: false, error: 'The Google Sheet link must be 500 characters or fewer.' };
    }

    const match = sheetLinkPattern.exec(trimmed);
    if (!match) {
        return { ok: false, error: 'Enter a Google Sheets link starting with https://docs.google.com/spreadsheets/d/ and a valid sheet ID.' };
    }

    const sheetId = match[1];
    return { ok: true, url: `${sheetBaseUrl}${sheetId}/edit`, sheetId };
}

export function sheetLinkRowPatch(patch: { roadmapSheetUrl?: string | null; roadmapSheetId?: string | null }) {
    if (patch.roadmapSheetUrl === undefined) {
        return { ok: true, roadmap_sheet_url: undefined, roadmap_sheet_id: undefined } as const;
    }

    const result = resolveSheetLinkPatch(patch.roadmapSheetUrl ?? '');
    if (!result.ok) return result;

    return { ok: true, roadmap_sheet_url: result.roadmapSheetUrl, roadmap_sheet_id: result.roadmapSheetId } as const;
}

export function resolveSheetLinkPatch(input: string):
    { ok: true; roadmapSheetUrl: string | null; roadmapSheetId: string | null } | SheetLinkError {
    if (!input.trim()) {
        return { ok: true, roadmapSheetUrl: null, roadmapSheetId: null };
    }

    const result = parseSheetLink(input);
    if (!result.ok) return result;

    return { ok: true, roadmapSheetUrl: result.url, roadmapSheetId: result.sheetId };
}
