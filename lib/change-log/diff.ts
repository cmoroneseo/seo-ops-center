export interface DiffToken {
    kind: 'same' | 'removed' | 'added' | 'moved';
    /** Word from the old text. Present for same, removed, and a move kept on the old line. */
    before: string | null;
    /** Word from the new text. Present for same, added, and a move kept on the new line. */
    after: string | null;
}

/** Letters and digits, so "Family," and "Family" count as the same word. */
export function wordKey(word: string): string {
    const stripped = word.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return stripped || word.toLowerCase();
}

export function tokenizeWords(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    return trimmed.split(/\s+/);
}

/**
 * Word-level diff. Shared words stay in their original order.
 * A short longest-common-subsequence over words; no extra dependency.
 */
export function wordDiff(before: string, after: string): DiffToken[] {
    const oldWords = tokenizeWords(before);
    const newWords = tokenizeWords(after);
    const pairs = commonWordPairs(oldWords, newWords);
    const tokens: DiffToken[] = [];
    let oldIndex = 0;
    let newIndex = 0;
    for (const [sharedOld, sharedNew] of pairs) {
        while (oldIndex < sharedOld) {
            tokens.push({ kind: 'removed', before: oldWords[oldIndex], after: null });
            oldIndex += 1;
        }
        while (newIndex < sharedNew) {
            tokens.push({ kind: 'added', before: null, after: newWords[newIndex] });
            newIndex += 1;
        }
        tokens.push({ kind: 'same', before: oldWords[oldIndex], after: newWords[newIndex] });
        oldIndex += 1;
        newIndex += 1;
    }
    while (oldIndex < oldWords.length) {
        tokens.push({ kind: 'removed', before: oldWords[oldIndex], after: null });
        oldIndex += 1;
    }
    while (newIndex < newWords.length) {
        tokens.push({ kind: 'added', before: null, after: newWords[newIndex] });
        newIndex += 1;
    }
    return quietMoves(tokens);
}

/**
 * A word that was deleted and inserted with the same spelling only moved.
 * Leave it plain on both lines instead of listing it as removed and added.
 */
function quietMoves(tokens: DiffToken[]): DiffToken[] {
    const removed = new Map<string, number>();
    const added = new Map<string, number>();
    for (const token of tokens) {
        if (token.kind === 'removed' && token.before) bump(removed, wordKey(token.before));
        if (token.kind === 'added' && token.after) bump(added, wordKey(token.after));
    }
    const shared = new Map<string, number>();
    for (const [key, count] of removed) {
        const other = added.get(key) ?? 0;
        if (other > 0) shared.set(key, Math.min(count, other));
    }
    const usedRemoved = new Map<string, number>();
    const usedAdded = new Map<string, number>();
    return tokens.map(token => {
        if (token.kind === 'removed' && token.before && take(shared, usedRemoved, wordKey(token.before))) {
            return { kind: 'moved', before: token.before, after: null };
        }
        if (token.kind === 'added' && token.after && take(shared, usedAdded, wordKey(token.after))) {
            return { kind: 'moved', before: null, after: token.after };
        }
        return token;
    });
}

function bump(counts: Map<string, number>, key: string) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
}

function take(shared: Map<string, number>, used: Map<string, number>, key: string): boolean {
    const budget = shared.get(key) ?? 0;
    const taken = used.get(key) ?? 0;
    if (taken >= budget) return false;
    used.set(key, taken + 1);
    return true;
}

export function removedWords(tokens: readonly DiffToken[]): string[] {
    return tokens.flatMap(token => token.kind === 'removed' && token.before ? [token.before] : []);
}

export function addedWords(tokens: readonly DiffToken[]): string[] {
    return tokens.flatMap(token => token.kind === 'added' && token.after ? [token.after] : []);
}

function commonWordPairs(oldWords: readonly string[], newWords: readonly string[]): Array<[number, number]> {
    const oldCount = oldWords.length;
    const newCount = newWords.length;
    const lengths: number[][] = Array.from({ length: oldCount + 1 }, () => Array(newCount + 1).fill(0));
    for (let oldIndex = oldCount - 1; oldIndex >= 0; oldIndex -= 1) {
        for (let newIndex = newCount - 1; newIndex >= 0; newIndex -= 1) {
            lengths[oldIndex][newIndex] = wordKey(oldWords[oldIndex]) === wordKey(newWords[newIndex])
                ? lengths[oldIndex + 1][newIndex + 1] + 1
                : Math.max(lengths[oldIndex + 1][newIndex], lengths[oldIndex][newIndex + 1]);
        }
    }
    const pairs: Array<[number, number]> = [];
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < oldCount && newIndex < newCount) {
        if (wordKey(oldWords[oldIndex]) === wordKey(newWords[newIndex])) {
            pairs.push([oldIndex, newIndex]);
            oldIndex += 1;
            newIndex += 1;
        } else if (lengths[oldIndex + 1][newIndex] > lengths[oldIndex][newIndex + 1]) {
            oldIndex += 1;
        } else {
            // On a tie, keep the old word so a neighbor that only swapped places can still match.
            newIndex += 1;
        }
    }
    return pairs;
}
