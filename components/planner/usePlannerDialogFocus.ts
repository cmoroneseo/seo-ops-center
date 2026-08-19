'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
    createPlannerSurfaceStack,
    cycleFocusIndex,
    selectPlannerFocusTarget,
    shouldRestorePlannerFocus,
    type PlannerCloseReason,
    type PlannerFocusObservation,
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

function isNativeFocusTarget(element: HTMLElement): boolean {
    const tag = element.tagName.toLowerCase();
    if (['button', 'input', 'select', 'textarea', 'iframe', 'object', 'embed', 'summary'].includes(tag)) {
        return true;
    }
    if ((tag === 'a' || tag === 'area') && element.hasAttribute('href')) return true;
    if ((tag === 'audio' || tag === 'video') && element.hasAttribute('controls')) return true;
    return false;
}

/** Read current DOM eligibility; pure selection logic lives in responsive.ts. */
function observeFocusTarget(element: HTMLElement): PlannerFocusObservation {
    const view = element.ownerDocument.defaultView;
    let display = view ? 'block' : 'none';
    let visibility = 'visible';
    let opacity = 1;

    if (view) {
        for (let current: HTMLElement | null = element; current; current = current.parentElement) {
            const style = view.getComputedStyle(current);
            if (style.display === 'none') display = 'none';
            if (style.visibility === 'hidden' || style.visibility === 'collapse') {
                visibility = style.visibility;
            }
            const currentOpacity = Number(style.opacity);
            if (Number.isFinite(currentOpacity)) opacity *= currentOpacity;
        }
    }

    return {
        connected: element.isConnected,
        hasClientRect: element.getClientRects().length > 0,
        disabled: element.matches(':disabled')
            || element.getAttribute('aria-disabled') === 'true',
        hidden: Boolean(element.closest('[hidden]')),
        inert: Boolean(element.closest('[inert]')),
        ariaHidden: Boolean(element.closest('[aria-hidden="true"]')),
        display,
        visibility,
        opacity,
        nativeFocusable: isNativeFocusTarget(element),
        contentEditable: element.isContentEditable,
        tabIndexAttribute: element.getAttribute('tabindex'),
    };
}

interface PlannerDialogFocusOptions {
    trapFocus: boolean;
    focusOnOpen?: boolean;
    restoreFocusRef?: RefObject<HTMLElement | null>;
}

export type RequestPlannerClose = (reason?: PlannerCloseReason) => void;

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
): RequestPlannerClose {
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    const trapFocusRef = useRef(trapFocus);
    trapFocusRef.current = trapFocus;
    const focusOnOpenRef = useRef(focusOnOpen);
    focusOnOpenRef.current = focusOnOpen;
    const dialogRefRef = useRef(dialogRef);
    dialogRefRef.current = dialogRef;
    const restoreFocusRefRef = useRef(restoreFocusRef);
    restoreFocusRefRef.current = restoreFocusRef;
    const closeReasonRef = useRef<PlannerCloseReason>('programmatic');
    const requestClose = useCallback<RequestPlannerClose>((reason = 'programmatic') => {
        closeReasonRef.current = reason;
        closeRef.current();
    }, []);

    useEffect(() => {
        if (!open) return;
        closeReasonRef.current = 'programmatic';
        const activeElement = document.activeElement;
        const returnFocusTo = activeElement instanceof HTMLElement
            && activeElement !== document.body
            && activeElement !== document.documentElement
            ? activeElement
            : null;
        const fallbackFocusTarget = restoreFocusRefRef.current?.current;
        const dialog = dialogRefRef.current.current;
        if (!dialog) return;
        const unregister = plannerSurfaceStack.register(dialog);
        const focusFrame = window.requestAnimationFrame(() => {
            if (!focusOnOpenRef.current) return;
            const preferred = dialog.querySelector<HTMLElement>('[data-dialog-autofocus]');
            const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
            (preferred ?? first ?? dialog).focus();
        });

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!plannerSurfaceStack.isTop(dialog)) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                requestClose('escape');
                return;
            }
            if (event.key !== 'Tab' || !trapFocusRef.current) return;
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
            if (!shouldRestorePlannerFocus(closeReasonRef.current)) return;
            const underlyingSurface = plannerSurfaceStack.top();
            const candidates = [
                returnFocusTo,
                underlyingSurface,
                fallbackFocusTarget,
            ];
            const restoreTarget = selectPlannerFocusTarget(candidates, observeFocusTarget);
            if (!restoreTarget) return;
            window.requestAnimationFrame(() => {
                const revalidatedTarget = selectPlannerFocusTarget(
                    [restoreTarget, ...candidates],
                    observeFocusTarget,
                );
                revalidatedTarget?.focus();
            });
        };
    }, [open, requestClose]);

    return requestClose;
}
