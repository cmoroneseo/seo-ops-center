export interface CurvePoint {
    x: number;
    y: number;
}

function command(point: CurvePoint): string {
    return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

/** Catmull-Rom through the points, as cubic beziers. Can overshoot a flat step. */
export function smoothPath(points: CurvePoint[]): string {
    if (points.length === 0) return '';
    let path = `M${command(points[0])}`;
    if (points.length === 1) return path;
    for (let index = 0; index < points.length - 1; index += 1) {
        const previous = points[index - 1] ?? points[index];
        const current = points[index];
        const next = points[index + 1];
        const after = points[index + 2] ?? next;
        const control1 = {
            x: current.x + (next.x - previous.x) / 6,
            y: current.y + (next.y - previous.y) / 6,
        };
        const control2 = {
            x: next.x - (after.x - current.x) / 6,
            y: next.y - (after.y - current.y) / 6,
        };
        path += ` C${command(control1)} ${command(control2)} ${command(next)}`;
    }
    return path;
}

/**
 * Fritsch–Carlson monotone cubic. The curve stays between neighboring samples,
 * so a flat day is not drawn as a spike.
 */
export function monotoneCubicPath(points: CurvePoint[]): string {
    if (points.length === 0) return '';
    if (points.length === 1) return `M${command(points[0])}`;
    const count = points.length;
    const delta: number[] = [];
    const slope: number[] = [];
    for (let index = 0; index < count - 1; index += 1) {
        const dx = points[index + 1].x - points[index].x;
        delta[index] = dx === 0 ? 0 : (points[index + 1].y - points[index].y) / dx;
    }
    slope[0] = delta[0];
    slope[count - 1] = delta[count - 2];
    for (let index = 1; index < count - 1; index += 1) {
        slope[index] = delta[index - 1] * delta[index] <= 0 ? 0 : (delta[index - 1] + delta[index]) / 2;
    }
    for (let index = 0; index < count - 1; index += 1) {
        if (delta[index] === 0) {
            slope[index] = 0;
            slope[index + 1] = 0;
            continue;
        }
        const left = slope[index] / delta[index];
        const right = slope[index + 1] / delta[index];
        const squared = left * left + right * right;
        if (squared > 9) {
            const tau = 3 / Math.sqrt(squared);
            slope[index] = tau * left * delta[index];
            slope[index + 1] = tau * right * delta[index];
        }
    }
    let path = `M${command(points[0])}`;
    for (let index = 0; index < count - 1; index += 1) {
        const dx = (points[index + 1].x - points[index].x) / 3;
        const control1 = { x: points[index].x + dx, y: points[index].y + slope[index] * dx };
        const control2 = { x: points[index + 1].x - dx, y: points[index + 1].y - slope[index + 1] * dx };
        path += ` C${command(control1)} ${command(control2)} ${command(points[index + 1])}`;
    }
    return path;
}
