import {
    ROADMAP_COPY,
    doneOnLabel,
    roadmapIsEmpty,
    type ClientRoadmap,
} from '@/lib/reports/roadmap';

const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const DONE = '#16a34a';
const ACCENT = '#ef4444';

/** The client view of the live roadmap. No settings and no staff fields. */
export function RoadmapReportView({ roadmap }: { roadmap: ClientRoadmap }) {
    const empty = roadmapIsEmpty(roadmap);
    return (
        <section data-roadmap-block>
            <h2 className="text-lg font-semibold border-b-2 pb-2 mb-4" style={{ color: INK, borderColor: ACCENT }}>
                {ROADMAP_COPY.title}
            </h2>
            {roadmap.stages.length === 0 ? <Note>{ROADMAP_COPY.noStages}</Note> : null}
            {roadmap.stages.length > 0 && empty ? (
                <div>
                    <Note>{ROADMAP_COPY.empty}</Note>
                    <ul className="mt-4 space-y-3">
                        {roadmap.stages.map(stage => (
                            <li key={stage.id} data-roadmap-stage={stage.id}>
                                <div className="text-sm font-semibold" style={{ color: INK }}>{stage.title}</div>
                                <p className="text-sm" style={{ color: MUTED }}>{stage.description}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
            {!empty ? (
                <div className="space-y-6">
                    {roadmap.stages.map(stage => (
                        <section key={stage.id} data-roadmap-stage={stage.id}>
                            <div className="flex items-baseline justify-between gap-3">
                                <h3 className="text-sm font-semibold" style={{ color: INK }}>{stage.title}</h3>
                                {stage.total > 0 ? (
                                    <p className="text-sm font-medium" style={{ color: DONE }} data-roadmap-progress>
                                        {stage.progress}
                                    </p>
                                ) : null}
                            </div>
                            <p className="mt-1 text-sm" style={{ color: MUTED }}>{stage.description}</p>
                            {stage.tasks.length === 0 ? (
                                <p className="mt-2 text-sm italic" style={{ color: '#9ca3af' }}>{ROADMAP_COPY.stageEmpty}</p>
                            ) : (
                                <ul className="mt-2" style={{ borderTop: `1px solid ${LINE}` }}>
                                    {stage.tasks.map((task, index) => (
                                        <li
                                            key={`${stage.id}-${index}`}
                                            data-roadmap-task
                                            className="py-2"
                                            style={{ borderBottom: `1px solid ${LINE}` }}
                                        >
                                            <div className="flex items-baseline justify-between gap-3 text-sm">
                                                <span className="font-medium" style={{ color: INK }}>{task.title}</span>
                                                <span style={{ color: task.status === 'Done' ? DONE : MUTED }}>{task.status}</span>
                                            </div>
                                            {task.doneOn ? (
                                                <p className="mt-0.5 text-xs" style={{ color: MUTED }}>{doneOnLabel(task.doneOn)}</p>
                                            ) : null}
                                            {task.description ? (
                                                <p className="mt-1 text-[13px] leading-snug" style={{ color: MUTED }}>{task.description}</p>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    ))}
                </div>
            ) : null}
        </section>
    );
}

function Note({ children }: { children: string }) {
    return <p className="text-sm" style={{ color: MUTED }}>{children}</p>;
}
