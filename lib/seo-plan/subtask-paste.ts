/**
 * Lines pasted into a parent's Add subtask field.
 *
 * Every kept line is a subtask of that parent. Indent does not open another
 * level. Leading bullets, dashes, numbers, and checkboxes are stripped.
 * A paste with no newline stays in the field. One kept line replaces the
 * field. Several lines wait for a confirm that shows the count.
 */

import { subtaskLineDrafts } from '../tasks/live-url';
import { stripStageAddLine } from './stage-add-lines';

/** Non-empty lines, in paste order, with list marks removed. */
export function parseSubtaskPaste(text: string): string[] {
    const titles: string[] = [];
    for (const raw of text.split(/\r?\n|\r/)) {
        if (!raw.trim()) continue;
        const title = stripStageAddLine(raw);
        if (!title) continue;
        titles.push(title);
    }
    return titles;
}

export type SubtaskPaste =
    | { kind: 'none' }
    | { kind: 'line'; title: string }
    | { kind: 'preview'; lines: string[]; titles: string[] };

/**
 * `lines` go to the create path, so a live URL stays on the line and can be
 * stored. `titles` are the names in the confirm, after that URL is lifted out.
 */
export function readSubtaskPaste(text: string): SubtaskPaste {
    if (!/[\r\n]/.test(text)) return { kind: 'none' };
    const lines = parseSubtaskPaste(text);
    if (lines.length === 0) return { kind: 'none' };
    if (lines.length === 1) return { kind: 'line', title: lines[0] ?? '' };
    return {
        kind: 'preview',
        lines,
        titles: subtaskLineDrafts(lines).map(draft => draft.title),
    };
}
