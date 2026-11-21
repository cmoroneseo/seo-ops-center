import {
    ROADMAP_COPY,
    doneOnLabel,
    presentRoadmap,
    type ClientRoadmapInput,
} from '@/lib/reports/roadmap';

const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const DONE = '#16a34a';
const ACCENT = '#ef4444';

/** The client view of the live roadmap. No settings and no staff fields. */
export function RoadmapReportView({ roadmap }: { roadmap: ClientRoadmapInput }) {
    const { groups } = presentRoadmap(roadmap, { showTaskDescriptions: true });
    const empty = groups.every(group => group.total === 0);
    return (
        <section data-roadmap-block>
            <h2 className="text-lg font-semibold border-b-2 pb-2 mb-4" style={{ color: INK, borderColor: ACCENT }}>
                {ROADMAP_COPY.title}
            </h2>
            {empty ? <Note>{ROADMAP_COPY.empty}</Note> : null}
            {groups.length > 0 ? (
                <div className={empty ? 'mt-4 space-y-6' : 'space-y-6'}>
                    {groups.map((group, groupIndex) => (
                        <section key={groupIndex} data-roadmap-group>
                            <div className="flex items-baseline justify-between gap-3">
                                <div>
                                    <h3 className="text-sm font-semibold" style={{ color: INK }}>{group.title}</h3>
                                    {group.status ? (
                                        <p className="mt-1 text-sm" style={{ color: MUTED }}>{group.status}</p>
                                    ) : null}
                                </div>
                                <p className="text-sm font-medium" style={{ color: group.total > 0 ? DONE : MUTED }} data-roadmap-progress>
                                    {group.progress}
                                </p>
                            </div>
                            {group.tasks.length > 0 ? (
                                <ul className="mt-2" style={{ borderTop: `1px solid ${LINE}` }}>
                                    {group.tasks.map((task, index) => (
                                        <li
                                            key={index}
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
                            ) : null}
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
