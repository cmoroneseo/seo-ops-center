import { MARKETING_PLAN_STEPS } from '../marketing-plan-template';

export const tabs = ['Roadmap', 'Content Plan'] as const;
export type SheetTab = typeof tabs[number];
export const phases = ['onboarding', 'month_1', 'month_2', 'month_3', 'backlog'] as const;
export type Phase = typeof phases[number];

export const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

export function buildImportKey(sheetId: string, tab: string, row: number): string {
    if (!/^[A-Za-z0-9_-]{25,100}$/.test(sheetId) || !/^[A-Za-z0-9 _-]{1,40}$/.test(tab)
        || !Number.isInteger(row) || row < 1 || row > 999999) {
        throw new Error('Invalid sheet ID, tab, or row number');
    }
    return `sheet:${sheetId}:${tab}:${row}`;
}

export function mapStatus(sheetStatus: string, target: 'marketing_plan_items' | 'tasks') {
    const status = normalize(sheetStatus);
    if (status === 'complete' || status === 'done') return 'done';
    if (target === 'tasks' && (status === 'in progress' || status === 'in review')) return 'in_progress';
    return 'todo';
}

const months = 'january february march april may june july august september october november december'.split(' ');

export function mapPhase(monthLabel: string, launchDate: string | null): { phase: Phase; monthLabel: string } {
    const label = normalize(monthLabel);
    let monthNumber = Number(/^month ([1-9]\d*)$/.exec(label)?.[1]);
    const calendarLabel = /^m\d+ \((.+)\)$/.exec(label)?.[1] ?? label;
    const calendar = /^([a-z]+) (\d{4})$/.exec(calendarLabel);
    const launch = /^(\d{4})-(0[1-9]|1[0-2])-\d{2}$/.exec(launchDate ?? '');
    if (calendar && launch) {
        const month = months.findIndex(name => name === calendar[1] || name.slice(0, 3) === calendar[1]);
        if (month >= 0) monthNumber = (Number(calendar[2]) - Number(launch[1])) * 12 + month + 2 - Number(launch[2]);
    }
    const phase = label === 'onboarding' || monthNumber < 1
        ? 'onboarding'
        : phases[monthNumber] ?? 'backlog';
    return { phase, monthLabel };
}

const aliases: Record<string, string> = {
    'analytics & reporting': 'setup',
    'technical': 'technical',
    'on-page': 'onpage',
    'content': 'content',
    'links': 'links',
    'off-page': 'links',
    'off-page seo': 'links',
    'research': 'research',
    'keyword research': 'research',
};

export function mapStepKey(category: string): string {
    const label = normalize(category);
    return MARKETING_PLAN_STEPS.find(step =>
        step.key === label || normalize(step.name) === label || step.key === aliases[label]
    )?.key ?? 'setup';
}

export function isStepKey(key: string): boolean {
    return MARKETING_PLAN_STEPS.some(step => step.key === key);
}
