import type { PartOfChoice } from '../tasks/part-of';
import { isPlanDone, type PlanGroup } from './plan-sections';
import { compareStageListTasks, groupTasksByStage, type StageListTask } from './stage-list';

export const NO_PROJECT_GROUP = 'no-project';

export function projectGroupId(task: StageListTask, projects: readonly Pick<PartOfChoice, 'id'>[]): string {
    return projects.find(project => project.id === task.initiativeId)?.id ?? NO_PROJECT_GROUP;
}

export function groupTasksByProject(
    tasks: readonly StageListTask[],
    projects: readonly PartOfChoice[],
    query = '',
) {
    const sections = new Map<string, PlanGroup[]>(
        [...projects.map(project => project.id), NO_PROJECT_GROUP].map(id => [id, []]),
    );
    for (const { groups } of groupTasksByStage(tasks, query)) {
        for (const group of groups) {
            if (group.parentBreadcrumb) continue;
            sections.get(projectGroupId(group.task, projects))?.push({
                ...group,
                urlCount: group.children.filter(child => Boolean(child.publishedUrl?.trim())).length,
                hiddenChildren: 0,
                rollupChildIds: group.children.map(child => child.id),
            });
        }
    }

    return [...projects, { id: NO_PROJECT_GROUP, title: 'No project' }].map(project => {
        const groups = sections.get(project.id) ?? [];
        groups.sort((a, b) => compareStageListTasks(a.task, b.task));
        const done = groups.filter(group => isPlanDone(group.task.status)).length;
        return { ...project, groups, count: groups.length, meta: `${done} / ${groups.length} done` };
    });
}
