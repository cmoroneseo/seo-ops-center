import test from 'node:test';
import assert from 'node:assert/strict';
import { monotoneCubicPath, smoothPath } from './curve.ts';

function ys(path: string): number[] {
    return [...path.matchAll(/(-?\d+\.\d+),(-?\d+\.\d+)/g)].map(match => Number(match[2]));
}

test('monotone smoothing stays inside a flat step that catmull-rom overshoots', () => {
    const points = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 10 },
    ];
    const smooth = ys(smoothPath(points));
    const monotone = ys(monotoneCubicPath(points));
    assert.equal(smooth.some(value => value > 10), true);
    assert.equal(monotone.every(value => value >= -0.001 && value <= 10.001), true);
    assert.equal(monotoneCubicPath([]), '');
    assert.equal(monotoneCubicPath([{ x: 4, y: 8 }]), 'M4.00,8.00');
});
