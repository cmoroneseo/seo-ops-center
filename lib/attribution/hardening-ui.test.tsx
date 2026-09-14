import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RoiCard } from '../../components/attribution/RoiCard.tsx';
import { buildTrackingSnippet, trackingScriptOrigin } from './install.ts';
import { isAttributionEnabledForOrganization } from './rollout.ts';

test('attribution rollout defaults to only the sandbox canary and supports an explicit allowlist', () => {
    assert.equal(isAttributionEnabledForOrganization('06e536b9-beac-49bc-8c96-1df021102590', undefined), true);
    assert.equal(isAttributionEnabledForOrganization('production-org', undefined), false);
    assert.equal(isAttributionEnabledForOrganization('production-org', 'org-a, production-org'), true);
    assert.equal(isAttributionEnabledForOrganization('production-org', '*'), true);
});

test('tracking snippets keep preview users on the canonical collector and carry telephone configuration', () => {
    assert.equal(trackingScriptOrigin('https://preview-123.vercel.app'), 'https://seo-ops-center.vercel.app');
    assert.equal(trackingScriptOrigin('http://localhost:3000'), 'http://localhost:3000');
    assert.equal(trackingScriptOrigin('https://preview-123.vercel.app', 'https://collector.example.com/'), 'https://collector.example.com');
    assert.equal(
        buildTrackingSnippet('https://collector.example.com', 'site-a', false),
        '<script defer src="https://collector.example.com/api/attribution/s.js" data-site="site-a" data-track-tel="false"></script>',
    );
});

test('pipeline card describes estimated conversion telemetry without inventing ROI or realized leads', () => {
    const html = renderToStaticMarkup(createElement(RoiCard, { conversions: 3, avgDealValue: 4500 }));
    assert.match(html, /Estimated Attributed Pipeline/);
    assert.match(html, /3 SEO\/AI conversion events/);
    assert.match(html, /\$13,500/);
    assert.match(html, /not realized revenue or financial ROI/);
    assert.doesNotMatch(html, /SEO drove|Retainer:|\d+(?:\.\d+)?x ROI/);
});
