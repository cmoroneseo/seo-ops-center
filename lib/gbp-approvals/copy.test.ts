import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const publicReview = readFileSync(new URL('../../components/gbp-approvals/PublicReview.tsx', import.meta.url), 'utf8');
const agency = readFileSync(new URL('../../components/gbp-approvals/AgencyStatus.tsx', import.meta.url), 'utf8');
const taskPanel = readFileSync(new URL('../../components/gbp-approvals/TaskApprovalsPanel.tsx', import.meta.url), 'utf8');
const copy = `${publicReview}\n${agency}\n${taskPanel}`;

test('client and agency copy follows the locked wording', () => {
    assert.doesNotMatch(copy, /goes live|go live/i);
    assert.match(publicReview, /Planned for \{weekday\(post\.scheduled\)\}/);
    assert.match(agency, /Planned for \{weekday\(item\.scheduled\)\}/);
    assert.doesNotMatch(agency, /agency-review\.css|#0A0A0B|#141416/);
    assert.match(agency, /Extend 14 days/);
    assert.match(publicReview, /Revision ready/);
    assert.match(publicReview, /Your name is required/);
    assert.match(publicReview, /Email <span className="lopt">\(optional\)<\/span>/);
    const expired = publicReview.slice(publicReview.indexOf("mode === 'expired'"), publicReview.indexOf('if (sent)'));
    assert.doesNotMatch(expired, /<form/);
    assert.match(expired, /Contact your account manager/);
    assert.match(agency, />Photo needed</);
    assert.match(agency, /mt-1 block text-sm text-muted-foreground/);
    assert.match(agency, /bg-card/);
    assert.match(agency, /text-emerald-950/);
    assert.match(agency, /text-amber-950/);
    assert.match(agency, /text-zinc-900/);
});
