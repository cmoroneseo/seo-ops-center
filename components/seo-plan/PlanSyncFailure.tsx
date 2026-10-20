'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    PLAN_BASECAMP_CLIENT_BANNER,
    PLAN_BASECAMP_FAILURE_BODY,
    PLAN_BASECAMP_FAILURE_TITLE,
    formatPlanSyncAttempt,
    type PlanBasecampSyncState,
} from '@/lib/seo-plan/basecamp-push';

export function PlanSyncBanner({ href }: { href: string }) {
    return (
        <p data-plan-basecamp-banner className="px-1 text-[13px] leading-5 text-[#cfcfd4]">
            {PLAN_BASECAMP_CLIENT_BANNER}{' '}
            <a href={href} className="text-[#ec4899] hover:underline">Fix in Integrations →</a>
        </p>
    );
}

/**
 * The 7px dot after a title whose last push failed.
 * Healthy rows render nothing. A client-wide failure hides this dot.
 */
export function PlanSyncDot({
    taskId,
    error,
    attemptedAt,
    integrationsHref,
    onRetry,
    defaultOpen = false,
}: {
    taskId: string;
    error: string | null;
    attemptedAt: string | null;
    integrationsHref: string;
    onRetry?: (taskId: string) => Promise<PlanBasecampSyncState | null>;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    const [pending, setPending] = useState(false);
    const [message, setMessage] = useState(error);
    const [attempt, setAttempt] = useState(attemptedAt);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const [box, setBox] = useState<{ top: number; left: number } | null>(null);

    useEffect(() => {
        setMessage(error);
        setAttempt(attemptedAt);
    }, [error, attemptedAt]);

    useEffect(() => {
        if (!open) return;
        const place = () => {
            const rect = buttonRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = 320;
            const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
            setBox({ top: rect.bottom + 8, left });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        const onPointer = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
            setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('mousedown', onPointer);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('mousedown', onPointer);
        };
    }, [open]);

    const retry = async () => {
        if (!onRetry || pending) return;
        setPending(true);
        try {
            const next = await onRetry(taskId);
            if (!next) return;
            setMessage(next.error);
            setAttempt(next.attemptedAt);
            if (next.state === 'ok') setOpen(false);
        } finally {
            setPending(false);
        }
    };

    const popover = (
        <div
            ref={popoverRef}
            role="dialog"
            aria-labelledby={titleId}
            data-plan-sync-popover={taskId}
            style={box ? { position: 'fixed', top: box.top, left: box.left } : undefined}
            className="z-50 w-80 rounded-xl border border-[#2a2a2e] bg-[#1a1a1e] p-3 text-left shadow-lg"
        >
            <p id={titleId} className="flex items-center gap-2 text-[13px] font-semibold text-white">
                <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#f87171]" aria-hidden="true" />
                {PLAN_BASECAMP_FAILURE_TITLE}
            </p>
            <p className="mt-1.5 text-[13px] leading-5 text-[#cfcfd4]">{PLAN_BASECAMP_FAILURE_BODY}</p>
            {message && (
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#2a2a2e] bg-[#141416] p-2 font-mono text-[11px] leading-4 text-[#cfcfd4]">
                    {message}
                </pre>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => { void retry(); }}
                    disabled={pending || !onRetry}
                    className="rounded-lg bg-[#ec4899] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#ec4899]/90 disabled:opacity-60"
                >
                    {pending ? 'Retrying' : 'Retry'}
                </button>
                <a
                    href={integrationsHref}
                    className="rounded-lg border border-[#3a3a40] px-3 py-1.5 text-[12px] text-[#cfcfd4] hover:text-white"
                >
                    Open Integrations
                </a>
                {attempt && (
                    <span className="text-[11px] leading-4 text-[#8b8b93]">{formatPlanSyncAttempt(attempt, Intl.DateTimeFormat().resolvedOptions().timeZone)}</span>
                )}
            </div>
        </div>
    );

    const inline = open && (typeof document === 'undefined' || !box);
    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                data-plan-sync-dot={taskId}
                aria-expanded={open}
                aria-label={PLAN_BASECAMP_FAILURE_TITLE}
                onClick={event => {
                    event.stopPropagation();
                    setOpen(current => !current);
                }}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
            >
                <span className="h-[7px] w-[7px] rounded-full bg-[#f87171]" />
            </button>
            {inline && popover}
            {open && box && typeof document !== 'undefined' && createPortal(popover, document.body)}
        </>
    );
}
