'use client';

import { useId, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { PAGE_TYPES, countWords, parseExclusionLines, parseLinkLines, parseManualRecord, type ManualRecordDraft } from '@/lib/topical-map/spec';
import { cn } from '@/lib/utils';
import { useOverlayA11y } from './useOverlayA11y';

const labelClass = 'text-xs font-medium uppercase tracking-wider text-muted-foreground';
const fieldClass = 'mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring';

interface AddRecordDialogProps {
    siloName: string;
    submitting?: boolean;
    error?: string;
    onClose: () => void;
    onSubmit: (draft: ManualRecordDraft) => void;
}

export function AddRecordDialog({ siloName, submitting = false, error, onClose, onSubmit }: AddRecordDialogProps) {
    const headingId = useId();
    const panelRef = useOverlayA11y(true, onClose);
    const [title, setTitle] = useState('');
    const [targetQuery, setTargetQuery] = useState('');
    const [pageType, setPageType] = useState('other');
    const [wordMin, setWordMin] = useState('');
    const [wordMax, setWordMax] = useState('');
    const [answer, setAnswer] = useState('');
    const [angle, setAngle] = useState('');
    const [scheduledFor, setScheduledFor] = useState('');
    const [specStatus, setSpecStatus] = useState('');
    const [staysOut, setStaysOut] = useState('');
    const [links, setLinks] = useState('');
    const [localError, setLocalError] = useState('');
    const words = countWords(answer);
    const message = localError || error;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        const parsedLinks = parseLinkLines(links);
        if (!parsedLinks.ok) {
            setLocalError(parsedLinks.error);
            return;
        }
        const parsed = parseManualRecord({
            title,
            targetQuery,
            pageType,
            wordCountMin: wordMin,
            wordCountMax: wordMax,
            answerFirst60: answer,
            uniqueAngle: angle,
            scheduledFor,
            specStatus,
            scopeExclusions: parseExclusionLines(staysOut),
            outgoingLinks: parsedLinks.links,
        });
        if (!parsed.ok) {
            setLocalError(parsed.error);
            return;
        }
        setLocalError('');
        onSubmit(parsed.draft);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={headingId}
                onClick={event => event.stopPropagation()}
                className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card shadow-xl"
            >
                <form onSubmit={submit} className="space-y-4 p-5">
                    <div>
                        <h2 id={headingId} className="text-base font-semibold">Add record</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Add a page to {siloName}. It is marked manual.
                        </p>
                    </div>

                    {message && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-500">{message}</p>}

                    <div>
                        <label htmlFor="add-record-title" className={labelClass}>Title</label>
                        <input
                            id="add-record-title"
                            data-autofocus="true"
                            value={title}
                            onChange={event => setTitle(event.target.value)}
                            required
                            disabled={submitting}
                            className={fieldClass}
                        />
                    </div>
                    <div>
                        <label htmlFor="add-record-query" className={labelClass}>Target query</label>
                        <input id="add-record-query" value={targetQuery} onChange={event => setTargetQuery(event.target.value)} disabled={submitting} placeholder="—" className={fieldClass} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="add-record-type" className={labelClass}>Page type</label>
                            <select id="add-record-type" value={pageType} onChange={event => setPageType(event.target.value)} disabled={submitting} className={fieldClass}>
                                {PAGE_TYPES.map(type => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="add-record-status" className={labelClass}>Spec status</label>
                            <select id="add-record-status" value={specStatus} onChange={event => setSpecStatus(event.target.value)} disabled={submitting} className={fieldClass}>
                                <option value="">—</option>
                                <option value="draft">Draft</option>
                                <option value="ready">Ready</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="add-record-min" className={labelClass}>Word range minimum</label>
                            <input id="add-record-min" inputMode="numeric" value={wordMin} onChange={event => setWordMin(event.target.value.replace(/\D/g, ''))} disabled={submitting} placeholder="—" className={fieldClass} />
                        </div>
                        <div>
                            <label htmlFor="add-record-max" className={labelClass}>Word range maximum</label>
                            <input id="add-record-max" inputMode="numeric" value={wordMax} onChange={event => setWordMax(event.target.value.replace(/\D/g, ''))} disabled={submitting} placeholder="—" className={fieldClass} />
                        </div>
                    </div>
                    <div>
                        <label htmlFor="add-record-answer" className={labelClass}>Answer in the first 60 words</label>
                        <textarea id="add-record-answer" value={answer} onChange={event => setAnswer(event.target.value)} disabled={submitting} rows={3} placeholder="—" aria-describedby="add-record-answer-count" className={fieldClass} />
                        <p id="add-record-answer-count" className={cn('mt-1 text-xs', words > 60 ? 'text-red-500' : 'text-muted-foreground')}>
                            {words === 0 ? 'Up to 60 words' : `${words} of 60 words`}
                        </p>
                    </div>
                    <div>
                        <label htmlFor="add-record-angle" className={labelClass}>Unique angle</label>
                        <textarea id="add-record-angle" value={angle} onChange={event => setAngle(event.target.value)} disabled={submitting} rows={2} placeholder="—" className={fieldClass} />
                    </div>
                    <div>
                        <label htmlFor="add-record-date" className={labelClass}>Scheduled for</label>
                        <input id="add-record-date" type="date" value={scheduledFor} onChange={event => setScheduledFor(event.target.value)} disabled={submitting} className={fieldClass} />
                    </div>
                    <div>
                        <label htmlFor="add-record-stays" className={labelClass}>Stays out of</label>
                        <textarea id="add-record-stays" value={staysOut} onChange={event => setStaysOut(event.target.value)} disabled={submitting} rows={2} placeholder={'/calculators/ | pricing tools'} className={fieldClass} />
                    </div>
                    <div>
                        <label htmlFor="add-record-links" className={labelClass}>Planned links</label>
                        <textarea id="add-record-links" value={links} onChange={event => setLinks(event.target.value)} disabled={submitting} rows={2} placeholder={'ROI formula | /blog/marketing-roi/'} className={fieldClass} />
                    </div>

                    <div className="flex gap-2 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={submitting}
                            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                            Add record
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
