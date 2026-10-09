'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import {
    RECEIPT_HOVER_OPEN_MS,
    buildReceiptContent,
    commitReceiptSignal,
    type ReceiptInput,
    type ReceiptInteraction,
    type ReceiptSignal,
} from '@/lib/reporting/receipt';

const CLOSED: ReceiptInteraction = { open: false, pinned: false };

const TAG_CLASS = {
    prelim: 'text-xs font-medium text-amber-700 dark:text-amber-400',
    snapshot: 'text-xs font-medium text-muted-foreground',
    ref: 'text-xs font-medium text-muted-foreground',
} as const;

/**
 * Tier A underlines the number. Tier B stays plain until `.reporting-row`
 * is hovered or focused, and a card puts the source on `SourceChip` instead.
 * Hover opens unpinned after 150ms. Click, Enter, or Space pins. Escape and
 * an outside click close and return focus to the trigger.
 */
export function Receipt({
    input,
    initialInteraction = CLOSED,
}: {
    input: ReceiptInput;
    initialInteraction?: ReceiptInteraction;
}) {
    const content = buildReceiptContent(input);
    const [interaction, setInteraction] = useState(initialInteraction);
    const interactionRef = useRef(interaction);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const rootRef = useRef<HTMLSpanElement>(null);
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const titleId = useId();
    const popoverId = useId();

    const apply = useCallback((signal: ReceiptSignal) => {
        const next = commitReceiptSignal(interactionRef.current, signal, triggerRef.current);
        interactionRef.current = next;
        setInteraction(next);
    }, []);

    useEffect(() => {
        if (!interaction.open) return;
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && rootRef.current?.contains(target)) return;
            apply({ type: 'outside' });
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            apply({ type: 'escape' });
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [interaction.open, apply]);

    useEffect(() => () => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
    }, []);

    const openLater = () => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => apply({ type: 'hover-open' }), RECEIPT_HOVER_OPEN_MS);
    };

    const closeHover = () => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        apply({ type: 'hover-close' });
    };

    const tierClass = content.tier === 'A'
        ? 'reporting-receipt-tier-a'
        : content.tier === 'B'
            ? 'reporting-receipt-tier-b'
            : '';

    return (
        <span
            ref={rootRef}
            className="relative inline-flex"
            onPointerEnter={openLater}
            onPointerLeave={closeHover}
        >
            <button
                ref={triggerRef}
                type="button"
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-expanded={interaction.open}
                aria-controls={interaction.open ? popoverId : undefined}
                aria-label={content.triggerLabel}
                data-receipt-tier={content.tier}
                className={`inline-flex items-baseline gap-1 bg-transparent p-0 text-inherit ${tierClass}`}
                onFocus={() => apply({ type: 'focus' })}
                onBlur={(event) => {
                    const next = event.relatedTarget;
                    const into = next instanceof Node && Boolean(rootRef.current?.contains(next));
                    apply({ type: 'blur', intoPopover: into });
                }}
                onClick={() => apply({ type: 'activate' })}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        apply({ type: 'activate' });
                        return;
                    }
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        apply({ type: 'escape' });
                    }
                }}
            >
                <span>{content.value}</span>
                {content.tag ? (
                    <span data-receipt-tag={content.tag} className={TAG_CLASS[content.tag]}>
                        {content.tag}
                    </span>
                ) : null}
            </button>
            {interaction.open ? (
                <div
                    id={popoverId}
                    role="dialog"
                    aria-labelledby={titleId}
                    className="reporting-receipt-popover absolute left-0 top-full z-30 mt-1 w-72 rounded-md border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
                    onKeyDown={(event) => {
                        if (event.key !== 'Escape') return;
                        event.preventDefault();
                        apply({ type: 'escape' });
                    }}
                >
                    <p id={titleId} className="font-semibold text-popover-foreground">{content.title}</p>
                    <dl className="mt-2 grid gap-1">
                        {content.rows.map((row) => (
                            <div key={row.label} className="flex gap-2" data-receipt-row={row.label}>
                                <dt className="font-medium text-popover-foreground">{row.label}</dt>
                                <dd className="text-popover-foreground">{row.value}</dd>
                            </div>
                        ))}
                    </dl>
                    {content.copyIssue && content.audience === 'staff' ? (
                        <p className="mt-2 text-popover-foreground">{content.copyIssue}</p>
                    ) : null}
                    {content.insightsHref ? (
                        <a className="mt-2 inline-block text-popover-foreground underline" href={content.insightsHref}>
                            {content.insightsLabel}
                        </a>
                    ) : null}
                </div>
            ) : null}
        </span>
    );
}
