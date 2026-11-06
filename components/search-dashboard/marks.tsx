'use client';

import type { KeyboardEvent } from 'react';
import { SOURCE_LABEL, type SearchSource } from '@/lib/search-dashboard/model';
import { cn } from '@/lib/utils';

export function SourceMark({ source, muted }: { source: SearchSource; muted: boolean }) {
    if (source === 'gsc') {
        const colors = muted ? ['currentColor', 'currentColor', 'currentColor', 'currentColor'] : ['#60a5fa', '#4ade80', '#facc15', '#f87171'];
        const heights = [8, 13, 6, 11];
        return (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
                {heights.map((height, index) => (
                    <rect key={index} x={1 + index * 4} y={15 - height} width="2.4" height={height} rx="0.6" fill={colors[index]} />
                ))}
            </svg>
        );
    }
    if (source === 'ga') {
        const fill = muted ? 'currentColor' : '#f5b14a';
        const heights = [7, 13, 10];
        return (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
                {heights.map((height, index) => (
                    <rect key={index} x={1.5 + index * 5} y={15 - height} width="3" height={height} rx="0.6" fill={fill} />
                ))}
            </svg>
        );
    }
    const fill = muted ? 'currentColor' : '#2dd4bf';
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
            <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" fill={fill} />
            <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" fill={fill} />
            <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" fill={fill} />
            <rect x="9" y="9" width="5.5" height="5.5" rx="1" fill={fill} />
        </svg>
    );
}

export function SourceSwitcher({
    sources,
    source,
    onSource,
}: {
    sources: SearchSource[];
    source: SearchSource | null;
    onSource: (source: SearchSource) => void;
}) {
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const current = source == null ? 0 : Math.max(0, sources.indexOf(source));
        let next = current;
        if (event.key === 'ArrowRight') next = Math.min(sources.length - 1, current + 1);
        else if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = sources.length - 1;
        else return;
        event.preventDefault();
        const id = sources[next];
        if (!id) return;
        onSource(id);
        document.getElementById(`search-source-${id}`)?.focus();
    };
    return (
        <div
            role="tablist"
            aria-label="Search sources"
            data-source-switcher="compact"
            className="inline-flex h-9 max-w-full items-center rounded-[8px] border border-[#27272a] bg-[#141418] p-[3px]"
            onKeyDown={onKeyDown}
        >
            {sources.map((id, index) => {
                const selected = source === id;
                return (
                    <button
                        key={id}
                        id={`search-source-${id}`}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls="search-source-panel"
                        tabIndex={source == null ? (index === 0 ? 0 : -1) : selected ? 0 : -1}
                        className={cn(
                            'inline-flex h-[30px] items-center gap-1.5 rounded-[6px] px-3 text-[13px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-[#141418]',
                            selected
                                ? 'border border-[#27272a] bg-[#1c1c22] font-semibold text-[#f4f4f5]'
                                : 'border border-transparent font-medium text-[#a1a1aa] hover:text-[#e4e4e7]',
                        )}
                        onClick={() => onSource(id)}
                    >
                        <SourceMark source={id} muted={!selected} />
                        {SOURCE_LABEL[id]}
                    </button>
                );
            })}
        </div>
    );
}
