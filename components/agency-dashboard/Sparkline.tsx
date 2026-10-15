import { useId } from 'react';
import { monotoneCubicPath, smoothPath, type CurvePoint } from '@/lib/agency-dashboard/curve';
import type { Tone } from '@/lib/agency-dashboard/metrics';

const STROKE: Record<Tone, string> = {
    up: '#34d399',
    down: '#fb7185',
    flat: '#a1a1aa',
};

function runs(values: Array<number | null>, width: number, height: number, scale: Array<number | null> = values): CurvePoint[][] {
    const known = scale.flatMap(value => value == null || !Number.isFinite(value) ? [] : [value]);
    if (known.length === 0) return [];
    const min = Math.min(...known);
    const max = Math.max(...known);
    const span = max - min || 1;
    const groups: CurvePoint[][] = [];
    let current: CurvePoint[] = [];
    values.forEach((value, index) => {
        if (value == null) {
            if (current.length) groups.push(current);
            current = [];
            return;
        }
        const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
        const y = height - ((value - min) / span) * (height - 6) - 3;
        current.push({ x, y });
    });
    if (current.length) groups.push(current);
    return groups;
}

/** Area sparkline. Missing days break the shape instead of being drawn as zero. */
export function Sparkline({
    values,
    overlay,
    tone,
    label,
    className = 'h-10 w-28',
    stretch = false,
    curve = 'smooth',
}: {
    values: Array<number | null>;
    /** Dashed series drawn on the same scale. Used for Bing in All mode. */
    overlay?: Array<number | null> | null;
    tone: Tone;
    label: string;
    className?: string;
    stretch?: boolean;
    /** Monotone stays between samples. The default curve is unchanged. */
    curve?: 'smooth' | 'monotone';
}) {
    const width = 120;
    const height = 36;
    const rawId = useId().replace(/:/g, '');
    const gradientId = `spark-${rawId}`;
    const scale = overlay ? [...values, ...overlay] : values;
    const groups = runs(values, width, height, scale);
    const overlayGroups = overlay ? runs(overlay, width, height, scale).filter(group => group.length >= 2) : [];
    const caption = overlay ? `${label}. Dashed line is Bing.` : label;
    const drawable = groups.filter(group => group.length >= 2);
    const draw = curve === 'monotone' ? monotoneCubicPath : smoothPath;
    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            className={className}
            role="img"
            aria-label={caption}
            preserveAspectRatio={stretch ? 'none' : 'xMidYMid meet'}
            {...(curve === 'monotone' ? { 'data-curve': 'monotone' } : {})}
        >
            <title>{caption}</title>
            {drawable.length > 0 && (
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={STROKE[tone]} stopOpacity="0.38" />
                        <stop offset="100%" stopColor={STROKE[tone]} stopOpacity="0" />
                    </linearGradient>
                </defs>
            )}
            {drawable.map(group => {
                const line = draw(group);
                const first = group[0];
                const last = group[group.length - 1];
                const area = `${line} L${last.x.toFixed(2)},${height} L${first.x.toFixed(2)},${height} Z`;
                return (
                    <g key={line}>
                        <path d={area} fill={`url(#${gradientId})`} stroke="none" />
                        <path d={line} fill="none" stroke={STROKE[tone]} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                );
            })}
            {overlayGroups.map(group => {
                const line = draw(group);
                return (
                    <path
                        key={`bing-${line}`}
                        data-bing-overlay=""
                        d={line}
                        fill="none"
                        stroke="#e4e4e7"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray="4 3"
                    />
                );
            })}
        </svg>
    );
}
