'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { cycleFocusIndex } from '@/lib/planner/responsive';

const FOCUSABLE = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Trap modal focus, close on Escape, and return focus to the opening control. */
export function usePlannerDialogFocus(
    dialogRef: RefObject<HTMLElement | null>,
    open: boolean,
    onClose: () => void,
): void {
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        if (!open) return;
        const returnFocusTo = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const focusFrame = window.requestAnimationFrame(() => {
            const dialog = dialogRef.current;
            if (!dialog) return;
            const preferred = dialog.querySelector<HTMLElement>('[data-dialog-autofocus]');
            const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
            (preferred ?? first ?? dialog).focus();
        });

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeRef.current();
                return;
            }
            if (event.key !== 'Tab') return;
            const dialog = dialogRef.current;
            if (!dialog) return;
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
            if (returnFocusTo?.isConnected) {
                window.requestAnimationFrame(() => returnFocusTo.focus());
            }
        };
    }, [dialogRef, open]);
}
