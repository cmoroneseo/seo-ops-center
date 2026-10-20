/**
 * Titles typed or pasted into a stage add bar.
 *
 * Enter submits one title as typed. A multi-line paste becomes one task per
 * line: list marks and blank lines are dropped, and the remaining titles stay
 * in paste order. A single pasted line is left in the field so Enter can
 * submit it.
 */

const LIST_MARK = /^(?:[-*•·–—]\s+|\d{1,3}[.)]\s+|\(\d{1,3}\)\s+)/;
const CHECKBOX = /^[[(][ xX][\])]\s+/;

export const STAGE_ADD_MAX_TITLES = 40;
export const STAGE_ADD_MAX_TITLE_LENGTH = 300;

/** One pasted row. Depth 1 is a subtask of the most recent depth-0 line. */
export interface StageAddLine {
    title: string;
    depth: 0 | 1;
}

/** Drop one leading bullet, number, or checkbox. Repeated so "1. - [ ] Title" collapses. */
export function stripStageAddLine(line: string): string {
    let value = line.replace(/^\uFEFF/, '').trim();
    for (let pass = 0; pass < 3; pass += 1) {
        if (!LIST_MARK.test(value) && !CHECKBOX.test(value)) break;
        value = value.replace(LIST_MARK, '').replace(CHECKBOX, '').trim();
    }
    if (/^[-*•·–—]$/.test(value)) return '';
    return value;
}

function leadingIndent(raw: string): { indent: number; nestedMark: boolean } {
    const rawIndent = raw.match(/^[ \t]*/)?.[0] ?? '';
    const rest = raw.slice(rawIndent.length).replace(/^\uFEFF/, '');
    return {
        indent: rawIndent.replace(/\t/g, '    ').length,
        nestedMark: rawIndent.length > 0 && (LIST_MARK.test(rest) || CHECKBOX.test(rest)),
    };
}

/**
 * Non-empty lines from a paste, in order.
 * A line at least two spaces (or a tab) deeper than the latest top-level line
 * is a subtask of that line. A nested bullet, number, or checkbox is too, even
 * when the extra indent is a single space. Deeper indents stay at depth 1.
 * An indented first line is top-level. Bullets, numbers, and checkboxes are stripped.
 */
export function parseStageAddLines(text: string): StageAddLine[] {
    const lines: StageAddLine[] = [];
    let topIndent: number | null = null;
    for (const raw of text.split(/\r?\n|\r/)) {
        if (!raw.trim()) continue;
        const { indent, nestedMark } = leadingIndent(raw);
        const title = stripStageAddLine(raw);
        if (!title) continue;
        const deeper = lines.length > 0
            && topIndent !== null
            && (indent >= topIndent + 2 || (nestedMark && indent > topIndent));
        const depth: 0 | 1 = deeper ? 1 : 0;
        if (depth === 0) topIndent = indent;
        lines.push({ title, depth });
    }
    return lines;
}

/** Pillar when the next kept line is a subtask of this top-level line. */
export function stageAddLineRole(lines: readonly StageAddLine[], index: number): 'task' | 'pillar' | 'subtask' {
    const line = lines[index];
    if (!line || line.depth === 1) return 'subtask';
    return lines[index + 1]?.depth === 1 ? 'pillar' : 'task';
}

/** Drop one preview row and parse again, so a removed pillar does not leave orphan indents. */
export function stageAddLinesWithout(lines: readonly StageAddLine[], index: number): StageAddLine[] {
    return parseStageAddLines(lines
        .filter((_, lineIndex) => lineIndex !== index)
        .map(line => `${line.depth === 1 ? '  ' : ''}${line.title}`)
        .join('\n'));
}

/** Enter creates one task. The title is trimmed and not rewritten. */
export function titlesFromStageAddEnter(value: string): string[] | null {
    const title = value.trim();
    return title.length > 0 ? [title] : null;
}

/**
 * A paste of several lines creates one task per line.
 * One line, or nothing but blanks, stays in the field.
 */
export function titlesFromStageAddPaste(text: string): string[] | null {
    const lines = linesFromStageAddPaste(text);
    return lines ? lines.map(line => line.title) : null;
}

/** A paste of several lines opens the preview. One line stays in the field. */
export function linesFromStageAddPaste(text: string): StageAddLine[] | null {
    const lines = parseStageAddLines(text);
    return lines.length > 1 ? lines : null;
}

/** Shared by the add bar and the create action so both reject the same batch. */
export function stageAddTitlesError(titles: readonly string[]): string | null {
    if (titles.length === 0) return 'Enter a title.';
    if (titles.length > STAGE_ADD_MAX_TITLES) {
        return `Add up to ${STAGE_ADD_MAX_TITLES} tasks at a time.`;
    }
    if (titles.some(title => title.length > STAGE_ADD_MAX_TITLE_LENGTH)) {
        return `Keep each title under ${STAGE_ADD_MAX_TITLE_LENGTH} characters.`;
    }
    return null;
}
