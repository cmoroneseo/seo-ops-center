'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { PLAN_KEYMAP } from '@/lib/seo-plan/plan-keymap';

/** The `?` sheet for the SEO Plan tab. */
export function PlanShortcutSheet({ onClose }: { onClose: () => void }) {
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        dialogRef.current?.focus();
    }, []);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            data-plan-shortcuts-backdrop
            onMouseDown={onClose}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                data-plan-shortcuts
                onMouseDown={event => event.stopPropagation()}
                className="w-full max-w-lg rounded-[10px] border border-[#2a2a2e] bg-[#141416] p-4 text-[#ececee] shadow-xl outline-none"
            >
                <div className="mb-3 flex items-center gap-2">
                    <h2 id={titleId} className="text-sm font-semibold">Keyboard shortcuts</h2>
                    <button
                        type="button"
                        aria-label="Close shortcuts"
                        onClick={onClose}
                        className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-[#8b8b93] hover:bg-[#1d1d22] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
                <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                    {PLAN_KEYMAP.map(item => (
                        <li key={item.keys} className="flex items-baseline justify-between gap-3 text-[13px]">
                            <span className="text-[#cfcfd4]">{item.label}</span>
                            <kbd className="shrink-0 rounded border border-[#2a2a2e] bg-[#1d1d22] px-1.5 py-0.5 font-mono text-[11px] text-[#ec4899]">
                                {item.keys}
                            </kbd>
                        </li>
                    ))}
                </ul>
                <p className="mt-3 text-[11px] leading-relaxed text-[#8b8b93]">
                    Shortcuts stay off while you are typing. Enter, Esc, and Tab still work in Add task.
                </p>
            </div>
        </div>
    );
}
