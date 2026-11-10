'use client';

import { cn } from '@/lib/utils';
import type { TopicalMapRecord } from '@/lib/types';
import { ACTION_LABEL, ACTION_STYLES, AI_ESTIMATE_CLASS, PAGE_TYPE_LABEL, PILL_CLASS, PRODUCTION_STATUS_STYLES, SOURCE_STYLES } from './constants';
import { AI_ESTIMATE_LABEL, hasAiDifficulty, hasAiSearchEstimate, hasAiVolume } from '@/lib/topical-map/metrics';
import { displayedProductionStatus, PRODUCTION_STATUS_LABEL, PUBLISHED_NOTE } from '@/lib/topical-map/production';
import { SOURCE_TITLE } from '@/lib/topical-map/spec';

function actionLabel(record: TopicalMapRecord): { label: string; className: string } {
    if (record.action === 'keep' && record.matchedUrl) {
        return { label: 'Existing', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' };
    }
    return { label: ACTION_LABEL[record.action], className: ACTION_STYLES[record.action] };
}

function DifficultyBar({ value, aiEstimate }: { value?: number; aiEstimate?: boolean }) {
    if (value === undefined) return <span className="text-xs text-muted-foreground">—</span>;
    const label = aiEstimate ? `${AI_ESTIMATE_LABEL}. Keyword difficulty ${value}` : `Keyword difficulty ${value}`;
    return (
        <div className="flex items-center gap-1.5" title={label}>
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
    const aiEstimate = hasAiSearchEstimate(record);
    const productionStatus = displayedProductionStatus(record);

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onClick(record)}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onClick(record);
                }
            }}
            className={cn(
                'grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/40',
                isChild && 'ml-6',
            )}
        >
            <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{record.title}</span>
                    <span
                        data-production-status={productionStatus}
                        title={productionStatus === 'published' ? PUBLISHED_NOTE : undefined}
                        className={cn('shrink-0', PILL_CLASS, PRODUCTION_STATUS_STYLES[productionStatus])}
                    >
                        {PRODUCTION_STATUS_LABEL[productionStatus]}
                    </span>
                    {record.source === 'manual' && (
                        <span title={SOURCE_TITLE.manual} className={cn(PILL_CLASS, SOURCE_STYLES.manual)}>manual</span>
                    )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{record.targetQuery.trim() || '—'}</span>
                {aiEstimate && (
                    <span className={cn('mt-1 inline-flex', PILL_CLASS, AI_ESTIMATE_CLASS)}>{AI_ESTIMATE_LABEL}</span>
                )}
            </span>
            <span className="hidden shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground sm:inline-block">
                {PAGE_TYPE_LABEL[record.pageType]}
            </span>
            {record.contentCategory && (
                <span className="hidden shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground md:inline-block">
                    {record.contentCategory}
                </span>
            )}
            <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium', action.className)}>
                {action.label}
            </span>
            <span
                className="hidden shrink-0 text-xs tabular-nums text-muted-foreground lg:inline-block"
                title={hasAiVolume(record) ? AI_ESTIMATE_LABEL : undefined}
            >
                {record.searchVolumeMonthly ? record.searchVolumeMonthly.toLocaleString() : '—'}
            </span>
            <span className="hidden shrink-0 lg:inline-block">
                <DifficultyBar value={record.keywordDifficulty} aiEstimate={hasAiDifficulty(record)} />
            </span>
        </div>
    );
}
