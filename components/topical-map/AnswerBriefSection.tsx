import type { AnswerBrief } from '@/lib/types';
import { answerNote, SCHEMA_TYPE_LABEL } from '@/lib/topical-map/answer-brief';

const labelClass = 'text-xs font-medium uppercase tracking-wider text-muted-foreground';

/** Read-only brief the generator wrote. The answer is shown here only when the spec section is not there to edit it. */
export function AnswerBriefSection({ brief, answer, showAnswer }: { brief: AnswerBrief; answer?: string; showAnswer: boolean }) {
    const note = answerNote(answer, brief.answerTrimmed);
    return (
        <section aria-label="Answer-ready brief" className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Answer-ready brief</h3>
            {(showAnswer && answer) || note ? (
                <div>
                    <p className={labelClass}>Direct answer</p>
                    {showAnswer && answer && <p className="mt-1 text-sm">{answer}</p>}
                    {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
                </div>
            ) : null}
            {brief.aiPrompts.length > 0 && (
                <div>
                    <p className={labelClass}>Questions people ask AI assistants</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                        {brief.aiPrompts.map(prompt => <li key={prompt}>{prompt}</li>)}
                    </ul>
                </div>
            )}
            {brief.headings.length > 0 && (
                <div>
                    <p className={labelClass}>Section headings</p>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm">
                        {brief.headings.map(heading => <li key={heading}>{heading}</li>)}
                    </ol>
                </div>
            )}
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <p className={labelClass}>Page markup</p>
                    <p className="mt-1 text-sm">{SCHEMA_TYPE_LABEL[brief.schemaType]}</p>
                </div>
                <div>
                    <p className={labelClass}>Price table</p>
                    <p className="mt-1 text-sm">{brief.priceTable ? 'Yes, with the date prices were checked' : 'Not needed'}</p>
                </div>
            </div>
        </section>
    );
}
