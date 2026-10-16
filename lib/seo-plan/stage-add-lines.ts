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

/** Drop one leading bullet, number, or checkbox. Repeated so "1. - [ ] Title" collapses. */
export function stripStageAddLine(line: string): string {
    let value = line.replace(/^\uFEFF/, '').trim();
    for (let pass = 0; pass < 3 && LIST_MARK.test(value); pass += 1) {
        value = value.replace(LIST_MARK, '').replace(CHECKBOX, '').trim();
    }
    return value;
}

/** Non-empty titles from a paste, in order. Bullets and numbering are removed. */
export function parseStageAddLines(text: string): string[] {
    return text.split(/\r?\n|\r/).map(stripStageAddLine).filter(line => line.length > 0);
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
    const titles = parseStageAddLines(text);
    return titles.length > 1 ? titles : null;
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
