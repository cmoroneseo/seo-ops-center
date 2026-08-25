export type SavedTrainingGuideState = { checked: boolean[]; selectedId: string };

export type TrainingGuideMessage =
    | { type: 'seo-playbook-ready' }
    | { type: 'seo-playbook-section'; id: string }
    | {
        type: 'seo-playbook-progress';
        completed: number;
        total: number;
        checked: boolean[];
        sections: Array<{ id: string; completed: number; total: number }>;
    };

export const DEFAULT_TRAINING_SECTION_ID = 'lp4b';

export function parseTrainingGuideState(value: string | null, validSectionIds: string[], totalItems: number): SavedTrainingGuideState {
    const fallbackId = validSectionIds.includes(DEFAULT_TRAINING_SECTION_ID)
        ? DEFAULT_TRAINING_SECTION_ID
        : (validSectionIds[0] ?? '');
    if (!value) return { checked: [], selectedId: fallbackId };

    try {
        const parsed: unknown = JSON.parse(value);
        const record = isRecord(parsed) ? parsed : undefined;
        const rawChecks = Array.isArray(parsed) ? parsed : record?.checked;
        const checked = Array.isArray(rawChecks)
            ? rawChecks.slice(0, totalItems).map((item) => item === true)
            : [];
        const selectedId = typeof record?.selectedId === 'string' && validSectionIds.includes(record.selectedId)
            ? record.selectedId
            : fallbackId;
        return { checked, selectedId };
    } catch {
        return { checked: [], selectedId: fallbackId };
    }
}

export function isTrainingGuideMessage(value: unknown, validSectionIds: string[], totalItems: number): value is TrainingGuideMessage {
    if (!isRecord(value) || typeof value.type !== 'string') return false;
    if (value.type === 'seo-playbook-ready') return true;
    if (value.type === 'seo-playbook-section') {
        return typeof value.id === 'string' && validSectionIds.includes(value.id);
    }
    if (value.type !== 'seo-playbook-progress') return false;
    if (!isCount(value.completed) || !isCount(value.total) || value.total !== totalItems || value.completed > value.total) return false;
    if (!Array.isArray(value.checked) || value.checked.length > totalItems || !value.checked.every((item) => typeof item === 'boolean')) return false;
    if (!Array.isArray(value.sections)) return false;
    return value.sections.every((section) => {
        if (!isRecord(section) || typeof section.id !== 'string' || !validSectionIds.includes(section.id)) return false;
        return isCount(section.completed) && isCount(section.total) && section.completed <= section.total;
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 0;
}
