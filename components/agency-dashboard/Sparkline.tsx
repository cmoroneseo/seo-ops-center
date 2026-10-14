import type { Tone } from '@/lib/agency-dashboard/metrics';

const STROKE: Record<Tone, string> = {
    up: '#34d399',
    down: '#fb7185',
    flat: '#a1a1aa',
};

/** Breaks the line on missing days so a gap is not drawn as zero. */
export function Sparkline({ values, tone, label }: { values: Array<number | null>; tone: Tone; label: string }) {
    const width = 96;
    const height = 32;
    const known = values.flatMap((value, index) => value == null ? [] : [{ index, value }]);
    if (known.length < 2) {
        return <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-24" role="img" aria-label={label}><title>{label}</title></svg>;
    }
    const min = Math.min(...known.map(point => point.value));
    const max = Math.max(...known.map(point => point.value));
    const span = max - min || 1;
    const segments: string[] = [];
    let commands: string[] = [];
    values.forEach((value, index) => {
        if (value == null) {
            if (commands.length) segments.push(commands.join(' '));
            commands = [];
            return;
        }
        const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
        const y = height - ((value - min) / span) * (height - 4) - 2;
        commands.push(`${commands.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
    });
    if (commands.length) segments.push(commands.join(' '));
    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-24" role="img" aria-label={label}>
            <title>{label}</title>
            {segments.map(path => (
                <path key={path} d={path} fill="none" stroke={STROKE[tone]} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            ))}
        </svg>
    );
}
