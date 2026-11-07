import { cn } from '@/lib/utils';
import type { InitiativeTone } from '@/lib/campaign-workspace/initiatives';

const LABEL: Record<InitiativeTone, string> = {
    neutral: 'text-[#71717a]',
    'in-progress': 'text-[#2563eb]',
    approval: 'text-[#b45309]',
    blocked: 'text-[#e11d48]',
    fresh: 'text-[#15803d]',
    stale: 'text-[#3f3f46]',
    incomplete: 'text-[#52525b]',
};

const MARK: Record<InitiativeTone, string> = {
    neutral: 'bg-[#a1a1aa]',
    'in-progress': 'bg-[#2563eb]',
    approval: 'bg-[#b45309]',
    blocked: 'bg-[#e11d48]',
    fresh: 'bg-[#15803d]',
    stale: 'border border-[#71717a] bg-white',
    incomplete: 'border border-[#a1a1aa] bg-white',
};

const BAR: Record<InitiativeTone, string> = {
    neutral: 'bg-[#a1a1aa]',
    'in-progress': 'bg-[#2563eb]',
    approval: 'bg-[#b45309]',
    blocked: 'bg-[#e11d48]',
    fresh: 'bg-[#15803d]',
    stale: 'border border-[#71717a] bg-transparent',
    incomplete: 'border border-[#a1a1aa] bg-transparent',
};

export function initiativeToneClass(tone: InitiativeTone): string {
    return LABEL[tone];
}

export function initiativeBarClass(tone: InitiativeTone): string {
    return BAR[tone];
}

export function InitiativeMark({ tone }: { tone: InitiativeTone }) {
    return <span aria-hidden="true" className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', MARK[tone])} />;
}
