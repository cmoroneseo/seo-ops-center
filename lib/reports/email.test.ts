import test from 'node:test';
import assert from 'node:assert/strict';
import { scottColeReport } from './client-fixture';
import { buildReportEmail, reportFromHeader, reportPortalUrl, reportReplyTo } from './email';

const model = scottColeReport('staff');

test('the From header is the account manager via the agency, replying to the manager', () => {
    assert.equal(
        reportFromHeader('Abel Miranda', 'Marketing Empire Group', 'reports@example.com'),
        'Abel Miranda via Marketing Empire Group <reports@example.com>',
    );
    assert.equal(reportReplyTo('abel@example.com'), 'abel@example.com');
    const from = reportFromHeader('Abel\nBcc: evil@x.com', 'Agency', 'reports@example.com');
    assert.equal(from?.includes('\n'), false);
    assert.equal(reportReplyTo('abel@example.com\nBcc: evil@x.com'), null);
    assert.equal(reportFromHeader('Abel', 'Agency', 'not-an-email'), null);
});

test('the email is the one-page summary plus a safe portal link, with no attachment', () => {
    const email = buildReportEmail({
        model,
        amName: 'Abel Miranda',
        amEmail: 'abel@example.com',
        agencyName: 'Marketing Empire Group',
        verifiedFrom: 'reports@example.com',
        to: 'scott@example.com',
        siteUrl: 'https://seo-ops-center.vercel.app',
        clientId: '33333333-3333-4333-8333-333333333333',
        reportId: '11111111-1111-4111-8111-111111111111',
    });
    assert.ok(email);
    assert.equal(email.to, 'scott@example.com');
    assert.equal(email.replyTo, 'abel@example.com');
    assert.equal(email.from, 'Abel Miranda via Marketing Empire Group <reports@example.com>');
    assert.equal(email.html.includes('No September work is recorded'), false);
    assert.equal(email.html.includes('Open the report in your portal'), true);
    assert.equal(email.html.includes('Eastvale'), false);
    assert.equal('attachments' in email, false);
    const link = reportPortalUrl('https://seo-ops-center.vercel.app', '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111');
    assert.equal(link.startsWith('https://seo-ops-center.vercel.app/portal/login?'), true);
    assert.equal(link.includes('next=%2Fportal%2Freports%2F11111111-1111-4111-8111-111111111111'), true);
});
