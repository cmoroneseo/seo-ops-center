export interface DiffPart {
    kind: 'same' | 'removed' | 'added';
    text: string;
}

/** Word diff for the agency and client "what changed" panels. */
export function diffWords(before: string, after: string): DiffPart[] {
    const left = before.split(/(\s+)/);
    const right = after.split(/(\s+)/);
    const rows = left.length;
    const cols = right.length;
    const scores: number[][] = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));
    for (let i = rows - 1; i >= 0; i -= 1) {
        for (let j = cols - 1; j >= 0; j -= 1) {
            scores[i][j] = left[i] === right[j]
                ? scores[i + 1][j + 1] + 1
                : Math.max(scores[i + 1][j], scores[i][j + 1]);
        }
    }
    const parts: DiffPart[] = [];
    let i = 0;
    let j = 0;
    const push = (kind: DiffPart['kind'], text: string) => {
        if (!text) return;
        const last = parts[parts.length - 1];
        if (last && last.kind === kind) last.text += text;
        else parts.push({ kind, text });
    };
    while (i < rows && j < cols) {
        if (left[i] === right[j]) {
            push('same', left[i]);
            i += 1;
            j += 1;
        } else if (scores[i + 1][j] >= scores[i][j + 1]) {
            push('removed', left[i]);
            i += 1;
        } else {
            push('added', right[j]);
            j += 1;
        }
    }
    while (i < rows) push('removed', left[i++]);
    while (j < cols) push('added', right[j++]);
    return parts;
}
