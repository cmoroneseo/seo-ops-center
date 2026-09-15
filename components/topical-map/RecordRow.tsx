'use client';

import { cn } from '@/lib/utils';
import type { MapRecordStatus, TopicalMapRecord } from '@/lib/types';
import { ACTION_STYLES } from './constants';

const STATUS_DOT: Record<MapRecordStatus, string> = {
    pending: 'bg-muted-foreground/40',
    approved: 'bg-emerald-500',
    declined: 'bg-red-500',
};

function actionLabel(record: TopicalMapRecord): { label: string; className: string } {
    if (record.action === 'keep' && record.matchedUrl) {
        return { label: 'Existing', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' };
    }
    return { label: record.action, className: ACTION_STYLES[record.action] };
}

function DifficultyBar({ value }: { value?: number }) {
    if (value === undefined) return <span className="text-xs text-muted-foreground">—</span>;
    return (
        <div className="flex items-center gap-1.5" title={`Keyword difficulty ${value}`}>
            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                <div
                    className={cn(
                        'h-full rounded-full',
                        value < 30 ? 'bg-emerald-500' : value < 60 ? 'bg-amber-500' : 'bg-red-500',
                    )}
                    style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                />
            </div>
            <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{value}</span>
        </div>
    );
}

interface RecordRowProps {
    record: TopicalMapRecord;
    isChild?: boolean;
    onClick: (record: TopicalMapRecord) => void;
}

export function RecordRow({ record, isChild, onClick }: RecordRowProps) {
    const action = actionLabel(record);

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onClick(record)}
            onKeyDown={e => { if (e.key === 'Enter') onClick(record); }}
            className={cn(
                'grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto] items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/40',
                isChild && 'ml-6',
            )}
        >
            <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[record.status])} aria-label={`Status: ${record.status}`} />
            <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{record.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{record.targetQuery}</span>
            </span>
            <span className="hidden shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase text-muted-foreground sm:inline-block">
                {record.pageType.replaceAll('_', ' ')}
            </span>
            {record.contentCategory && (
                <span className="hidden shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground md:inline-block">
                    {record.contentCategory}
                </span>
            )}
            <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase', action.className)}>
                {action.label}
            </span>
            <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground lg:inline-block">
                {record.searchVolumeMonthly !== undefined ? record.searchVolumeMonthly.toLocaleString() : '—'}
            </span>
            <span className="hidden shrink-0 lg:inline-block">
                <DifficultyBar value={record.keywordDifficulty} />
            </span>
        </div>
    );
}
