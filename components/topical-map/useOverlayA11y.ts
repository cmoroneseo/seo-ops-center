'use client';

import { useEffect, useRef } from 'react';
import { cycleTab } from '@/lib/topical-map/spec';

const FOCUSABLE = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableItems(root: HTMLElement | null): HTMLElement[] {
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element => {
        if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') return false;
        if (element.closest('[hidden]')) return false;
        return true;
    });
}

const overlayStack: Array<() => void> = [];

/** Trap Tab and close on Escape. Restores focus to whatever opened the surface. */
export function useOverlayA11y(open: boolean, onClose: () => void) {
    const ref = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!open) return;
        const close = () => onCloseRef.current();
        overlayStack.push(close);
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const items = focusableItems(ref.current);
        const preferred = items.find(element => element.getAttribute('data-autofocus') === 'true');
        (preferred ?? items[0])?.focus();

        const onKey = (event: KeyboardEvent) => {
            if (overlayStack[overlayStack.length - 1] !== close) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                close();
                return;
            }
            if (event.key !== 'Tab') return;
            const list = focusableItems(ref.current);
            event.preventDefault();
            if (list.length === 0) return;
            const index = list.indexOf(document.activeElement as HTMLElement);
            list[cycleTab(index, list.length, event.shiftKey)]?.focus();
        };

        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            const index = overlayStack.lastIndexOf(close);
            if (index >= 0) overlayStack.splice(index, 1);
            previous?.focus();
        };
    }, [open]);

    return ref;
}
