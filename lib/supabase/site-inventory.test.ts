import assert from 'node:assert/strict';
import test from 'node:test';

import { rowToSiteCrawlRun, rowsToSitePageObservations } from './site-inventory.ts';

test('maps snake-case crawl runs without inventing optional timestamps', () => {
    assert.deepEqual(rowToSiteCrawlRun({
        id: 'run', organization_id: 'org', client_id: 'client', seed_url: 'https://example.com/', configured_host: 'example.com',
        url_limit: 200, status: 'completed', discovered_count: 2, processed_count: 2, failed_count: 0, blocked_count: 0,
        cap_reached: false, stop_reason: null, error_summary: null, started_at: 'start', completed_at: 'end', created_at: 'created', updated_at: 'updated',
    }), {
        id: 'run', organizationId: 'org', clientId: 'client', seedUrl: 'https://example.com/', configuredHost: 'example.com',
        urlLimit: 200, status: 'completed', discoveredCount: 2, processedCount: 2, failedCount: 0, blockedCount: 0,
        capReached: false, startedAt: 'start', completedAt: 'end', createdAt: 'created', updatedAt: 'updated',
    });
});

test('joins aliases and computes inbound links from observed destinations', () => {
    const rows = rowsToSitePageObservations({
        seedUrl: 'https://example.com/',
        snapshots: [{
            id: 'snapshot', site_page_id: 'page', site_page_url_id: 'url', requested_url: 'https://example.com/', final_url: 'https://example.com/', observed_at: 'now',
            fetch_status: 'success', status_code: 200, content_type: 'text/html', response_bytes: 100, redirect_hops: [], robots_allowed: true,
            robots_directives: [], canonical_url: null, canonical_issue: 'none', title: 'Home', meta_description: null, h1s: ['Hi'], word_count: 20,
            outbound_internal_links: 1, limitation_flags: [],
        }],
        urls: [{ id: 'url', normalized_url: 'https://example.com/', discovery_sources: ['seed'] }],
        links: [{ destination_normalized_url: 'https://example.com/' }],
    });
    assert.equal(rows[0].inboundInternalLinks, 1);
    assert.equal(rows[0].isHomepage, true);
    assert.deepEqual(rows[0].discoverySources, ['seed']);
});
