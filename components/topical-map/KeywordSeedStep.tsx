'use client';

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';

import { addKeywordRow, keywordMetricCell, keywordSourceNotes, type KeywordRow, type MetricKind, type MetricSource } from '@/lib/onboarding/keyword-metrics';

export function KeywordSeedStep({
    rows,
    ahrefs,
    searchConsole,
    loading,
    notice,
    onToggle,
    onRows,
}: {
    rows: KeywordRow[];
    ahrefs: MetricSource;
    searchConsole: MetricSource;
    loading: boolean;
    notice: string | null;
    onToggle: (keyword: string) => void;
    onRows: (rows: KeywordRow[]) => void;
}) {
    const [draft, setDraft] = useState('');
    const [addError, setAddError] = useState('');
    const notes = keywordSourceNotes(ahrefs, searchConsole);

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

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                Choose the searches this topic map should cover. Uncheck any that do not fit, or add your own.
            </p>
            <p className="text-xs text-muted-foreground">{rows.filter(row => row.selected).length} selected</p>
            {notes.length > 0 && (
                <div className="space-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    {notes.map(note => <p key={note}>{note}</p>)}
                </div>
            )}
            {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
            {loading ? (
                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Looking up keywords…
                </div>
            ) : (
                <>
                    {rows.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No keyword ideas yet. Add your own below.</p>
                    ) : (
                        <div className="overflow-x-auto rounded-xl border border-border">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-muted/40 text-xs text-muted-foreground">
                                    <tr>
                                        <th className="px-3 py-2 font-medium" scope="col">Use</th>
                                        <th className="px-3 py-2 font-medium" scope="col">Keyword</th>
                                        <th className="px-3 py-2 font-medium" scope="col">Monthly searches</th>
                                        <th className="px-3 py-2 font-medium" scope="col">Difficulty</th>
                                        <th className="px-3 py-2 font-medium" scope="col">Your position</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(row => (
                                        <tr key={row.keyword} className="border-t border-border" data-keyword={row.keyword}>
                                            <td className="px-3 py-2">
                                                <input
                                                    type="checkbox"
                                                    checked={row.selected}
                                                    onChange={() => onToggle(row.keyword)}
                                                    aria-label={`Include ${row.keyword}`}
                                                />
                                            </td>
                                            <td className="px-3 py-2">{row.keyword}</td>
                                            <MetricCells row={row} ahrefs={ahrefs} searchConsole={searchConsole} />
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <div className="flex gap-2">
                        <input
                            value={draft}
                            onChange={event => setDraft(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    add();
                                }
                            }}
                            placeholder="Add a keyword"
                            aria-label="Add a keyword"
                            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                        <button type="button" onClick={add} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm">
                            <Plus className="h-3.5 w-3.5" />
                            Add
                        </button>
                    </div>
                    {addError && <p className="text-xs text-red-500">{addError}</p>}
                </>
            )}
        </div>
    );
}

function MetricCells({
    row,
    ahrefs,
    searchConsole,
}: {
    row: KeywordRow;
    ahrefs: MetricSource;
    searchConsole: MetricSource;
}) {
    const cells: { kind: MetricKind; source: MetricSource; value: number | null }[] = [
        { kind: 'volume', source: ahrefs, value: row.volume },
        { kind: 'difficulty', source: ahrefs, value: row.difficulty },
        { kind: 'position', source: searchConsole, value: row.position },
    ];
    return (
        <>
            {cells.map(cell => {
                const shown = keywordMetricCell(cell.value, cell.source, cell.kind);
                return (
                    <td key={cell.kind} className="px-3 py-2 text-muted-foreground">
                        <span data-metric={cell.kind} aria-label={shown.note ? `${shown.text}. ${shown.note}` : shown.text}>
                            {shown.text}
                        </span>
                    </td>
                );
            })}
        </>
    );
}
