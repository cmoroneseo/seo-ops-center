'use client';

import { useEffect, useRef, type RefObject } from 'react';
import {
    createPlannerSurfaceStack,
    cycleFocusIndex,
    resolveFocusRestoreTarget,
} from '@/lib/planner/responsive';

const FOCUSABLE = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

const plannerSurfaceStack = createPlannerSurfaceStack<HTMLElement>();

interface PlannerDialogFocusOptions {
    trapFocus: boolean;
    focusOnOpen?: boolean;
    restoreFocusRef?: RefObject<HTMLElement | null>;
}

/** Coordinate focus and Escape for modal and modeless planner surfaces. */
export function usePlannerDialogFocus(
    dialogRef: RefObject<HTMLElement | null>,
    open: boolean,
    onClose: () => void,
    {
        trapFocus,
        focusOnOpen = trapFocus,
        restoreFocusRef,
    }: PlannerDialogFocusOptions,
): void {
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        if (!open) return;
        const activeElement = document.activeElement;
        const returnFocusTo = activeElement instanceof HTMLElement
            && activeElement !== document.body
            && activeElement !== document.documentElement
            ? activeElement
            : null;
        const fallbackFocusTarget = restoreFocusRef?.current;
        const dialog = dialogRef.current;
        if (!dialog) return;
        const unregister = plannerSurfaceStack.register(dialog);
        const focusFrame = window.requestAnimationFrame(() => {
            if (!focusOnOpen) return;
            const preferred = dialog.querySelector<HTMLElement>('[data-dialog-autofocus]');
            const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
            (preferred ?? first ?? dialog).focus();
        });

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!plannerSurfaceStack.isTop(dialog)) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeRef.current();
                return;
            }
            if (event.key !== 'Tab' || !trapFocus) return;
            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
                .filter(element => !element.hasAttribute('disabled'));
            if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            const currentIndex = current === -1
                ? (event.shiftKey ? 0 : focusable.length - 1)
                : current;
            event.preventDefault();
            focusable[cycleFocusIndex(currentIndex, focusable.length, event.shiftKey)]?.focus();
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener('keydown', handleKeyDown);
            unregister();
            const underlyingSurface = plannerSurfaceStack.top();
            const restoreTarget = resolveFocusRestoreTarget(
                returnFocusTo,
                resolveFocusRestoreTarget(underlyingSurface, fallbackFocusTarget),
            );
            if (restoreTarget) {
                window.requestAnimationFrame(() => restoreTarget.focus());
            }
        };
    }, [dialogRef, focusOnOpen, open, restoreFocusRef, trapFocus]);
}
