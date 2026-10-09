import { useEffect, useState, type ReactNode } from 'react';
import { Globe, MapPin } from 'lucide-react';

import { SourceChip } from '@/components/reporting/SourceChip';
import type { FormattedDelta } from '@/lib/reporting/delta';
import { clusterHeatStyle, type SourceLine } from '@/lib/search-insights/view';
import { resolveSurfaceColors } from '@/lib/theme/surface-colors';

const TOKEN_NAMES = ['--chart-1', '--reporting-map', '--map', '--reporting-info', '--info', '--reporting-org-fallback', '--org-fallback'];

/** Organic stays `--chart-1` unless the theme guard has to fall back. */
export function useSurfaceColors(): { organic: string; map: string } {
    const [colors, setColors] = useState({ organic: 'var(--chart-1)', map: 'var(--map)' });
    useEffect(() => {
        const styles = getComputedStyle(document.documentElement);
        const tokens: Record<string, string> = {};
        for (const name of TOKEN_NAMES) {
            const value = styles.getPropertyValue(name).trim();
            if (value) tokens[name] = value;
        }
        const mode = document.documentElement.classList.contains('light') ? 'light' : 'dark';
        const resolved = resolveSurfaceColors(tokens, mode);
        setColors({ organic: resolved.organic, map: resolved.map });
    }, []);
    return colors;
}

export function SurfaceMark({ name }: { name: string }) {
    const colors = useSurfaceColors();
    const map = name === 'Map pack';
    const Icon = map ? MapPin : Globe;
    return (
        <span className="inline-flex items-center gap-1" style={{ color: map ? colors.map : colors.organic }}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {name}
        </span>
    );
}

const TONE = {
    neutral: 'text-muted-foreground',
    good: 'text-green-600',
    bad: 'text-red-600',
} as const;

/** Renders a delta the read model already computed. */
export function DeltaReadout({ delta }: { delta: FormattedDelta | null }) {
    if (!delta || delta.kind === 'missing') return null;
    if (delta.kind === 'distorted') {
        return (
            <span className="inline-flex flex-wrap items-baseline gap-1 text-sm text-foreground" data-delta="distorted">
                <s className="text-muted-foreground">{delta.priorLabel}</s>
                <span>{delta.reason}</span>
            </span>
        );
    }
    return (
        <span className={`text-[11px] font-semibold ${TONE[delta.tone]}`} data-delta={delta.kind} title={delta.percentHover}>
            {delta.text}
        </span>
    );
}

export function CardSource({ source }: { source: SourceLine | null }) {
    if (!source) return null;
    return <SourceChip source={source.source} rangeLabel={source.rangeLabel} staleLabel={source.staleLabel} />;
}

export function InsightTable({ label, head, children }: { label: string; head: string[]; children: ReactNode }) {
    return (
        <div className="insights-table-scroll">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm" aria-label={label}>
                <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                        {head.map(cell => (
                            <th key={cell} scope="col" className="px-3 py-2 font-medium">{cell}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>{children}</tbody>
            </table>
        </div>
    );
}

export function PositionCell({ value, text }: { value: number | null; text: string }) {
    if (value == null) return <td className="px-3 py-2 text-muted-foreground">{text}</td>;
    return (
        <td className="px-3 py-2 tabular-nums text-foreground" style={{ background: clusterHeatStyle(value) }}>
            {text}
        </td>
    );
}

export function PanelCard({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
    return (
        <section className="min-w-0 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-medium text-foreground">{title}</h3>
                {extra}
            </div>
            <div className="mt-3">{children}</div>
        </section>
    );
}
