'use client';

import { useEffect, useState } from 'react';
import {
    plannerSurfaceBehavior,
    type PlannerSurfaceBehavior,
    type PlannerSurfaceKind,
} from '@/lib/planner/responsive';

const DESKTOP_VIEWPORT = Number.POSITIVE_INFINITY;

/** Tracks the breakpoint that changes a planner surface from modal to modeless. */
export function usePlannerSurfaceBehavior(kind: PlannerSurfaceKind): PlannerSurfaceBehavior {
    const [viewportWidth, setViewportWidth] = useState(DESKTOP_VIEWPORT);

    useEffect(() => {
        const update = () => setViewportWidth(window.innerWidth);
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    return plannerSurfaceBehavior(kind, viewportWidth);
}
