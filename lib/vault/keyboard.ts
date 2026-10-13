export type VaultKeyResult = number | 'open' | 'close' | 'search' | null;

export function isVaultTypingTarget(target: EventTarget | null): boolean {
    if (!target || typeof target !== 'object' || !('tagName' in target)) return false;
    const element = target as { tagName?: string; isContentEditable?: boolean };
    const tag = element.tagName?.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true;
}

export function moveVaultSelection(current: number, count: number, key: string, typing = false): VaultKeyResult {
    if (key === '/' && !typing) return 'search';
    if (key === 'Escape') return 'close';
    if (count <= 0) return null;
    if (key === 'Enter') return current >= 0 ? 'open' : null;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    if (key === 'ArrowDown' || (key === 'j' && !typing)) {
        if (current < 0) return 0;
        return Math.min(count - 1, current + 1);
    }
    if (key === 'ArrowUp' || (key === 'k' && !typing)) {
        if (current <= 0) return 0;
        return current - 1;
    }
    return null;
}
