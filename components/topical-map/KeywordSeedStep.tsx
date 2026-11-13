'use client';

import { useState, type ReactNode } from 'react';
import { CheckCircle2, Info, Loader2, Minus, Check, Plug, Plus, Search, Sparkles } from 'lucide-react';

import {
    NEEDS_SEARCH_CONSOLE,
    addKeywordRow,
    hasKeywordReasons,
    keywordPositionCell,
    keywordReasonText,
    rankParts,
    type KeywordRow,
    type MetricSource,
} from '@/lib/onboarding/keyword-metrics';
import { cn } from '@/lib/utils';

const FOCUS = 'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#ec4899]';
const SECONDARY_BUTTON = cn(
    'inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[#d4d4d8] bg-white px-[14px] text-[13.5px] font-semibold text-[#18181b] hover:bg-[#fafafa]',
    FOCUS,
);
const TH = 'h-[38px] border-b border-[#e4e4e7] bg-[#fafafa] px-[14px] text-left align-middle text-[11.5px] font-bold uppercase leading-[1.25] tracking-[.05em] text-[#52525b]';
const TD = 'h-[52px] border-b border-[#f0f0f2] px-[14px] align-middle text-[13.5px]';

function searchConsoleSetupHref(clientId: string): string {
    return `/workspace/${encodeURIComponent(clientId)}?tab=integrations&setup=search-console`;
}

function Checkbox({ state }: { state: 'on' | 'off' | 'mixed' }) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                'inline-grid h-[18px] w-[18px] flex-none place-items-center rounded-[5px] border-[1.5px] text-white',
                state === 'off' ? 'border-[#71717a] bg-white' : 'border-[#18181b] bg-[#18181b]',
            )}
        >
            {state === 'on' && <Check className="h-3 w-3" strokeWidth={3} />}
            {state === 'mixed' && <Minus className="h-3 w-3" strokeWidth={3} />}
        </span>
    );
}

function SourceChip({ icon, label, tool, source }: { icon: ReactNode; label: string; tool: string; source: MetricSource }) {
    return (
        <div className="flex items-center gap-2 rounded-[9px] border border-[#e4e4e7] bg-[#fafafa] px-[11px] py-[7px] text-[12.5px] text-[#52525b]">
            {icon}
            {label} <b className="font-semibold text-[#18181b]">{tool}</b>
            {source === 'connected' ? (
                <span className="inline-flex items-center gap-1 font-bold text-[#15803d]">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Connected
                </span>
            ) : (
                <span className="font-bold text-[#92400e]">Couldn&apos;t load this time</span>
            )}
        </div>
    );
}

function ConnectBanner({ title, body, button, href }: { title: string; body: string; button: string; href: string }) {
    return (
        <div className="flex flex-wrap items-center gap-[14px] rounded-[10px] border border-[#f59e0b] bg-[#fffbeb] px-[14px] py-3 text-[#78350f]">
            <Plug className="h-5 w-5 flex-none text-[#b45309]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <b className="block text-[13.5px] font-bold text-[#78350f]">{title}</b>
                <p className="mt-0.5 text-[12.5px]">{body}</p>
            </div>
            <a href={href} target="_blank" rel="noopener noreferrer" className={cn(SECONDARY_BUTTON, 'ml-auto')}>
                {button}<span className="sr-only"> (opens in a new tab)</span>
            </a>
        </div>
    );
}

function HeaderNote({ children }: { children: ReactNode }) {
    return <span className="mt-px block text-[11px] font-medium normal-case tracking-normal text-[#52525b]">{children}</span>;
}

function RankCell({ row, source }: { row: KeywordRow; source: MetricSource }) {
    const shown = keywordPositionCell(row.position, source);
    if (shown.note) {
        return <span data-metric="position" className="text-[#52525b]" aria-label={shown.note} title={shown.note}>—</span>;
    }
    if (row.position == null || row.position <= 0) {
        return <span data-metric="position" className="text-[#52525b]">{shown.text}</span>;
    }
    const { rank, page } = rankParts(row.position);
    return (
        <span data-metric="position">
            <b className="font-bold">#{rank}</b> <span className="text-xs text-[#52525b]">· page {page} of Google</span>
        </span>
    );
}

export function KeywordSeedStep({
    clientId,
    clientName,
    rows,
    searchConsole,
    loading,
    notice,
    onToggle,
    onRows,
    onSuggestAgain,
}: {
    clientId: string;
    clientName: string;
    rows: KeywordRow[];
    searchConsole: MetricSource;
    loading: boolean;
    notice: string | null;
    onToggle: (keyword: string) => void;
    onRows: (rows: KeywordRow[]) => void;
    onSuggestAgain?: () => void;
}) {
    const [draft, setDraft] = useState('');
    const [addError, setAddError] = useState('');
    const name = clientName.trim() || 'this client';
    const selected = rows.filter(row => row.selected).length;
    const allState = rows.length > 0 && selected === rows.length ? 'on' : selected === 0 ? 'off' : 'mixed';
    const showReasons = hasKeywordReasons(rows);
    const gscMissing = searchConsole === 'missing';

    const add = () => {
        const result = addKeywordRow(rows, draft);
        if (result.error) {
            setAddError(result.error);
            return;
        }
        setAddError('');
        setDraft('');
        onRows(result.rows);
    };

    const toggleAll = () => {
        const next = allState !== 'on';
        onRows(rows.map(row => ({ ...row, selected: next })));
    };

    return (
        <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold">Choose the keywords {name} should show up for</h2>
                    <p className="mt-1 max-w-[720px] text-[13.5px] leading-normal text-[#52525b]">
                        We suggested these from the brand profile and the competitors you added. Keep the ones that matter to the business. The topic map is planned around them.
                    </p>
                </div>
                {onSuggestAgain && (
                    <button
                        type="button"
                        onClick={onSuggestAgain}
                        disabled={loading}
                        className={cn('inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#be185d] hover:underline disabled:opacity-50 dark:text-pink-300', FOCUS)}
                    >
                        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
                        Suggest again
                    </button>
                )}
            </div>

            {gscMissing ? (
                <div className="my-4">
                    <ConnectBanner
                        title="Connect Google Search Console to see where you rank"
                        body="Google Search Console is Google's free tool that shows where this website appears in search."
                        button="Connect Google Search Console"
                        href={searchConsoleSetupHref(clientId)}
                    />
                </div>
            ) : (
                <div className="my-4 flex flex-wrap items-center gap-2.5">
                    <SourceChip
                        icon={<Search className="h-[15px] w-[15px]" aria-hidden="true" />}
                        label="Where you rank from"
                        tool="Google Search Console"
                        source={searchConsole}
                    />
                </div>
            )}
            {notice && (
                <p className="mb-3 flex items-start gap-1.5 text-[12.5px] text-[#52525b]">
                    <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />{notice}
                </p>
            )}

            <div className="flex flex-wrap items-center gap-3 rounded-t-[10px] border border-b-0 border-[#e4e4e7] bg-white px-[14px] py-2.5">
                <button
                    type="button"
                    role="checkbox"
                    aria-checked={allState === 'mixed' ? 'mixed' : allState === 'on'}
                    onClick={toggleAll}
                    disabled={loading || rows.length === 0}
                    className={cn('inline-flex min-h-8 items-center gap-2 rounded text-[13px] font-semibold disabled:opacity-50', FOCUS)}
                >
                    <Checkbox state={allState} />Select all
                </button>
                <span className="text-[13px] text-[#52525b]" aria-live="polite">
                    <b className="text-[#18181b]">{selected} of {rows.length}</b> selected
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                    <label className="flex h-9 w-[260px] items-center gap-2 rounded-lg border border-[#d4d4d8] px-2.5 text-[13px] focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-[#ec4899]">
                        <Plus className="h-3.5 w-3.5 flex-none text-[#71717a]" aria-hidden="true" />
                        <span className="sr-only">Add your own keyword</span>
                        <input
                            value={draft}
                            onChange={event => setDraft(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    add();
                                }
                            }}
                            placeholder="Add your own keyword"
                            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#71717a]"
                        />
                    </label>
                    <button type="button" onClick={add} className={SECONDARY_BUTTON}>Add keyword</button>
                </div>
            </div>
            {addError && (
                <p role="alert" className="border-x border-[#e4e4e7] bg-white px-[14px] pb-2 text-[12.5px] font-semibold text-[#b91c1c]">{addError}</p>
            )}

            <div className="overflow-x-auto rounded-b-[10px] border border-[#e4e4e7]">
                <table className="w-full min-w-[760px] table-fixed border-collapse">
                    <colgroup>
                        <col style={{ width: 52 }} />
                        <col style={{ width: showReasons ? '40%' : '55%' }} />
                        <col style={{ width: showReasons ? '30%' : undefined }} />
                        {showReasons && <col />}
                    </colgroup>
                    <thead>
                        <tr>
                            <th className={cn(TH, 'pr-0')} scope="col"><span className="sr-only">Use</span></th>
                            <th className={TH} scope="col">Keyword</th>
                            <th className={cn(TH, 'h-12')} scope="col">
                                Where you rank now{gscMissing && <HeaderNote>{NEEDS_SEARCH_CONSOLE}</HeaderNote>}
                            </th>
                            {showReasons && <th className={TH} scope="col">Why it&apos;s suggested</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={showReasons ? 4 : 3} className={cn(TD, 'h-24 border-b-0 text-center text-[#52525b]')}>
                                    <span role="status" className="inline-flex items-center gap-2">
                                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Looking up keywords…
                                    </span>
                                </td>
                            </tr>
                        ) : rows.length === 0 ? (
                            <tr>
                                <td colSpan={showReasons ? 4 : 3} className={cn(TD, 'h-24 border-b-0 text-center text-[#52525b]')}>
                                    No keyword ideas yet. Add your own above.
                                </td>
                            </tr>
                        ) : rows.map(row => (
                            <tr key={row.keyword} data-keyword={row.keyword} className={cn('[&:last-child>td]:border-b-0', row.selected && '[&>td]:bg-[#fcfcfd]')}>
                                <td className={cn(TD, 'pr-0')}>
                                    <button
                                        type="button"
                                        role="checkbox"
                                        aria-checked={row.selected}
                                        aria-label={`Include ${row.keyword}`}
                                        onClick={() => onToggle(row.keyword)}
                                        className={cn('inline-flex min-h-8 items-center rounded', FOCUS)}
                                    >
                                        <Checkbox state={row.selected ? 'on' : 'off'} />
                                    </button>
                                </td>
                                <td className={TD}>
                                    <span className="font-semibold">{row.keyword}</span>
                                    {row.reason === 'added' && (
                                        <span className="ml-1.5 whitespace-nowrap rounded-full border border-[#ddd6fe] bg-[#f5f3ff] px-[7px] py-px text-[11px] font-bold text-[#6d28d9]">
                                            Added by you
                                        </span>
                                    )}
                                </td>
                                <td className={TD}><RankCell row={row} source={searchConsole} /></td>
                                {showReasons && (
                                    <td className={cn(TD, 'text-[12.5px] text-[#52525b]')}>
                                        {row.reason ? keywordReasonText(row.reason) : null}
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="mt-3 text-[12.5px] leading-normal text-[#52525b]">
                <b className="text-[#18181b]">How we measure demand:</b> the topic map uses Google Search Console, which shows the searches where this website already appears in Google and how often people see it.
            </p>
        </div>
    );
}

