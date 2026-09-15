import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileRecord, determineAction } from './reconcile.ts';

describe('reconcileRecord', () => {
    const basePage = {
        pageId: 'page-1',
        normalizedUrl: '/artificial-grass-installation',
        title: 'Artificial Grass Installation in San Diego',
        h1s: ['Artificial Grass Installation'],
        wordCount: 1200,
    };

    it('returns create when no match found', () => {
        const result = reconcileRecord(
            { targetQuery: 'pool remodeling cost', title: 'Pool Remodeling Cost Guide' },
            [],
            [],
        );
        assert.equal(result.action, 'create');
        assert.equal(result.sitePageId, undefined);
    });

    it('matches by exact normalized URL', () => {
        const result = reconcileRecord(
            { targetQuery: 'artificial grass', title: 'Artificial Grass', suggestedUrl: '/artificial-grass-installation' },
            [basePage],
            [],
        );
        assert.equal(result.sitePageId, 'page-1');
        assert.equal(result.matchedUrl, '/artificial-grass-installation');
    });

    it('matches by GSC query overlap', () => {
        const result = reconcileRecord(
            { targetQuery: 'artificial grass installation san diego', title: 'AG Install' },
            [basePage],
            [{ query: 'artificial grass installation san diego', pageUrl: '/artificial-grass-installation' }],
        );
        assert.equal(result.sitePageId, 'page-1');
    });

    it('matches by title substring', () => {
        const result = reconcileRecord(
            { targetQuery: 'grass install', title: 'Artificial Grass Installation' },
            [basePage],
            [],
        );
        assert.equal(result.sitePageId, 'page-1');
    });
});

describe('determineAction', () => {
    it('returns replace when word count < 300', () => {
        assert.equal(determineAction({ wordCount: 150, title: 'Some Title', h1s: ['H1'] }, 1000), 'replace');
    });

    it('returns replace when title is missing', () => {
        assert.equal(determineAction({ wordCount: 500, title: undefined, h1s: [] }, 1000), 'replace');
    });

    it('returns improve when word count below target min', () => {
        assert.equal(determineAction({ wordCount: 500, title: 'Title', h1s: ['H1'] }, 1000), 'improve');
    });

    it('returns keep when content is adequate', () => {
        assert.equal(determineAction({ wordCount: 1200, title: 'Title', h1s: ['H1'] }, 1000), 'keep');
    });
});
