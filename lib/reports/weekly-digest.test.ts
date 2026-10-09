import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findClientCopyViolations } from './copy-rules';
import {
    addIsoDays,
    buildDigestContent,
    buildWeeklyDigestEmail,
    coveredWeek,
    decideDigestCompose,
    decideDigestDelivery,
    digestIsCurrent,
    digestWeek,
    formatWeekLabel,
    isPacificMonday,
    proofUrl,
    weeklyDigestEventId,
    type DigestCandidate,
} from './weekly-digest';
import { weeklyDigestEnabled } from './digest-flag';

const clientId = '44444444-4444-4444-8444-444444444444';
const week = { start: '2026-10-05', end: '2026-10-11' };

function candidate(overrides: Partial<DigestCandidate> = {}): DigestCandidate {
    return {
        organizationId: '11111111-1111-4111-8111-111111111111',
        clientId,
        clientName: 'Scott Cole Plumbing',
        amName: 'Abel Miranda',
        amEmail: 'abel@example.com',
        agencyName: 'Marketing Empire Group',
        contacts: [{ id: '88888888-8888-4888-8888-888888888888', email: 'scott@example.com' }],
        deliverables: [
            {
                title: 'Service page',
                status: 'Published',
                deliveredOn: '2026-10-07',
                publishedUrl: 'https://scottcole.example/service',
            },
            {
                title: 'Homepage update',
                status: 'In Progress',
                deliveredOn: null,
                publishedUrl: null,
            },
        ],
        waiting: [{ title: 'Send the logo files' }],
        optedIn: true,
        ...overrides,
    };
}

test('the Pacific guard is Monday, including after daylight-saving time ends', () => {
    assert.equal(isPacificMonday(new Date('2026-10-12T16:00:00.000Z')), true);
    assert.equal(isPacificMonday(new Date('2026-10-12T06:30:00.000Z')), false);
    assert.equal(isPacificMonday(new Date('2026-11-02T16:00:00.000Z')), true);
    assert.equal(isPacificMonday(new Date('2026-11-02T07:30:00.000Z')), false);
    assert.deepEqual(digestWeek(new Date('2026-10-12T16:00:00.000Z')), week);
    assert.equal(digestWeek(new Date('2026-10-11T16:00:00.000Z')), null);
    assert.deepEqual(coveredWeek('2026-11-02'), { start: '2026-10-26', end: '2026-11-01' });
    assert.equal(addIsoDays('2026-10-12', -7), '2026-10-05');
});

test('the week label stays in plain dates', () => {
    assert.equal(formatWeekLabel('2026-10-05', '2026-10-11'), 'October 5–11');
    assert.equal(formatWeekLabel('2026-10-26', '2026-11-01'), 'October 26–November 1');
    assert.equal(formatWeekLabel('2026-12-28', '2027-01-03'), 'December 28, 2026–January 3, 2027');
});

test('the event id is stable per client and week', () => {
    const first = weeklyDigestEventId(clientId, week.start);
    assert.equal(first, weeklyDigestEventId(clientId, week.start));
    assert.notEqual(first, weeklyDigestEventId(clientId, '2026-10-12'));
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('content is shipped work with proof links, in progress, and waiting, without hours or metrics', () => {
    const content = buildDigestContent({
        week,
        deliverables: [
            { title: 'Service page', status: 'Published', deliveredOn: '2026-10-07', publishedUrl: 'https://scottcole.example/service' },
            { title: 'Older page', status: 'Published', deliveredOn: '2026-09-30', publishedUrl: 'https://scottcole.example/old' },
            { title: 'Draft notes', status: 'Published', deliveredOn: '2026-10-08', publishedUrl: 'javascript:alert(1)' },
            { title: '12 calls', status: 'Published', deliveredOn: '2026-10-08', publishedUrl: 'https://scottcole.example/calls' },
            { title: 'Homepage update', status: 'In Progress', deliveredOn: null, publishedUrl: null },
            { title: 'Internal review', status: 'Review', deliveredOn: null, publishedUrl: null },
            { title: 'Ready to send', status: 'Approved', deliveredOn: null, publishedUrl: null },
            { title: 'Already delivered', status: 'Approved', deliveredOn: '2026-10-01', publishedUrl: 'https://scottcole.example/done' },
            { title: 'Not started', status: 'Pending', deliveredOn: null, publishedUrl: null },
        ],
        waiting: [{ title: 'Send the logo files' }, { title: '12 calls' }],
    });
    assert.deepEqual(content.shipped, [
        { title: 'Draft notes', url: null },
        { title: 'Service page', url: 'https://scottcole.example/service' },
    ]);
    assert.deepEqual(content.inProgress.map(item => item.title), ['Homepage update', 'Internal review', 'Ready to send']);
    assert.deepEqual(content.waiting, [{ title: 'Send the logo files' }]);
    assert.equal(proofUrl('http://example.com/a'), 'http://example.com/a');
    assert.equal(proofUrl('notaurl'), null);
});

test('the email is from the account manager, links to the portal, and passes the client-copy lint', () => {
    const content = buildDigestContent({
        week,
        deliverables: candidate().deliverables,
        waiting: candidate().waiting,
    });
    const email = buildWeeklyDigestEmail({
        content,
        week,
        clientName: 'Scott Cole Plumbing',
        clientId,
        amName: 'Abel Miranda',
        amEmail: 'abel@example.com',
        agencyName: 'Marketing Empire Group',
        verifiedFrom: 'reports@example.com',
        to: 'scott@example.com',
        siteUrl: 'https://seo-ops-center.vercel.app',
    });
    assert.ok(email);
    assert.equal(email.from, 'Abel Miranda via Marketing Empire Group <reports@example.com>');
    assert.equal(email.replyTo, 'abel@example.com');
    assert.equal(email.to, 'scott@example.com');
    assert.equal(email.subject, 'Scott Cole Plumbing: Your week of October 5–11');
    assert.equal('attachments' in email, false);
    assert.equal(email.html.includes('Open your portal'), true);
    assert.equal([...email.html.matchAll(/href="([^"]*)"/g)].some(match => match[1] === 'https://scottcole.example/service'), true);
    assert.equal(email.html.includes('/portal/login?'), true);
    assert.equal(email.html.includes('next=%2Fportal%2Freports'), false);
    assert.equal(email.text.includes('next=%2Fportal&') || email.text.includes('next=%2Fportal'), true);
    assert.equal(findClientCopyViolations(email.text, ['gsc', 'organic_clicks', 'impressions', 'CALL_CLICKS']).length, 0);
    assert.equal(/\b(hours?|clicks?|impressions?|metrics?|rankings?|visits|visitors|leads|customers|people|calls)\b/i.test(email.text), false);
});

test('no contact, nothing to say, or opt-out does not queue', () => {
    assert.equal(decideDigestCompose({ candidate: candidate({ contacts: [] }), week }).action, 'skip');
    assert.equal(decideDigestCompose({ candidate: candidate({ contacts: [] }), week }).reason, 'no_contact');
    assert.equal(decideDigestCompose({
        candidate: candidate({ deliverables: [], waiting: [] }),
        week,
    }).reason, 'nothing_to_say');
    assert.equal(decideDigestCompose({ candidate: candidate({ optedIn: false }), week }).reason, 'not_opted_in');
    assert.equal(decideDigestCompose({ candidate: candidate({ amEmail: null }), week }).reason, 'no_manager');
    const queued = decideDigestCompose({ candidate: candidate(), week });
    assert.equal(queued.action, 'queue');
    if (queued.action === 'queue') assert.equal(queued.contactIds.length, 1);
});

test('a digest queued on Monday can retry that week and is dropped the next Monday', () => {
    const createdAt = '2026-10-12T16:00:00.000Z';
    assert.equal(digestIsCurrent(createdAt, new Date('2026-10-18T16:00:00.000Z')), true);
    assert.equal(digestIsCurrent(createdAt, new Date('2026-10-19T16:00:00.000Z')), false);
    const send = decideDigestDelivery({
        now: new Date('2026-10-13T16:00:00.000Z'),
        createdAt,
        eventId: weeklyDigestEventId(clientId, week.start),
        candidate: candidate(),
        verifiedFrom: 'reports@example.com',
        to: 'scott@example.com',
        siteUrl: 'https://seo-ops-center.vercel.app',
    });
    assert.equal(send.action, 'send');
    if (send.action === 'send') assert.equal(send.email.html.includes('4 hours'), false);
    const stale = decideDigestDelivery({
        now: new Date('2026-10-19T16:00:00.000Z'),
        createdAt,
        eventId: weeklyDigestEventId(clientId, week.start),
        candidate: candidate(),
        verifiedFrom: 'reports@example.com',
        to: 'scott@example.com',
        siteUrl: 'https://seo-ops-center.vercel.app',
    });
    assert.equal(stale.action, 'cancel');
    const optedOut = decideDigestDelivery({
        now: new Date('2026-10-12T16:05:00.000Z'),
        createdAt,
        eventId: weeklyDigestEventId(clientId, week.start),
        candidate: candidate({ optedIn: false }),
        verifiedFrom: 'reports@example.com',
        to: 'scott@example.com',
        siteUrl: 'https://seo-ops-center.vercel.app',
    });
    assert.equal(optedOut.action, 'cancel');
});

test('WEEKLY_DIGEST_ENABLED is on only for the exact string true', () => {
    const previous = process.env.WEEKLY_DIGEST_ENABLED;
    delete process.env.WEEKLY_DIGEST_ENABLED;
    assert.equal(weeklyDigestEnabled(), false);
    process.env.WEEKLY_DIGEST_ENABLED = '1';
    assert.equal(weeklyDigestEnabled(), false);
    process.env.WEEKLY_DIGEST_ENABLED = 'true';
    assert.equal(weeklyDigestEnabled(), true);
    if (previous === undefined) delete process.env.WEEKLY_DIGEST_ENABLED;
    else process.env.WEEKLY_DIGEST_ENABLED = previous;
});

test('the digest cron is one daily schedule and the generic sender does not treat it as a portal notice', () => {
    const vercel = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8');
    assert.equal(vercel.includes('/api/cron/weekly-digest'), true);
    assert.equal(vercel.includes('"0 16 * * *"'), true);
    const blocks = vercel.split('/api/cron/weekly-digest');
    assert.equal(blocks.length, 2);
    const delivery = readFileSync(new URL('../portal/email-delivery.ts', import.meta.url), 'utf8');
    assert.equal(delivery.includes("event_kind === 'weekly_digest'"), true);
    assert.equal(delivery.includes('weekly_digest:'), false);
    const run = readFileSync(new URL('./weekly-digest-run.ts', import.meta.url), 'utf8');
    assert.equal(run.includes('time_logs'), false);
    assert.equal(run.includes('seo_hours'), false);
    assert.equal(run.includes("from('metrics')"), false);
    assert.equal(run.includes('attachments'), false);
});
