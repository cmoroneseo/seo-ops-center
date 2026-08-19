import { test } from 'node:test';
import assert from 'node:assert/strict';

type LoadModule = typeof import('./project-catalog-load.ts');

async function loadModule(): Promise<LoadModule> {
    try {
        return await import('./project-catalog-load.ts');
    } catch (error) {
        assert.fail(`Basecamp picker load guard must be implemented: ${String(error)}`);
    }
}

test('persistent failure makes one request per open scope until retry or reopen is explicit', async () => {
    const { shouldLoadBasecampProjectCatalog } = await loadModule();
    let attempts = 0;
    let state = {
        open: true,
        hasCatalog: false,
        isLoading: false,
        error: null as string | null,
    };

    const runEffect = () => {
        if (!shouldLoadBasecampProjectCatalog(state)) return;
        attempts += 1;
        state = { ...state, error: 'persistent failure', isLoading: false };
    };

    runEffect();
    runEffect();
    runEffect();
    assert.equal(attempts, 1);

    // Explicit Retry clears the settled error and permits exactly one new attempt.
    state = { ...state, error: null };
    runEffect();
    runEffect();
    assert.equal(attempts, 2);

    // Closing does not request; explicitly reopening with cleared error does.
    state = { ...state, open: false };
    runEffect();
    state = { ...state, open: true, error: null };
    runEffect();
    runEffect();
    assert.equal(attempts, 3);
});

test('loading and loaded catalogs suppress duplicate requests', async () => {
    const { shouldLoadBasecampProjectCatalog } = await loadModule();
    assert.equal(shouldLoadBasecampProjectCatalog({
        open: true, hasCatalog: false, isLoading: true, error: null,
    }), false);
    assert.equal(shouldLoadBasecampProjectCatalog({
        open: true, hasCatalog: true, isLoading: false, error: null,
    }), false);
});
