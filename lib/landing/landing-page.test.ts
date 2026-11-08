import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

import { pricingTiers, pricingTrialLine } from './pricing.ts';

const root = new URL('../..', import.meta.url);

function read(path: string) {
    return readFileSync(new URL(path, root), 'utf8');
}

function landingSources() {
    const dir = new URL('components/landing/', root);
    const files = readdirSync(dir).filter(name => name.endsWith('.tsx') || name.endsWith('.ts'));
    return files.map(name => readFileSync(new URL(name, dir), 'utf8')).join('\n');
}

const page = read('app/page.tsx');
const landing = landingSources();
const layout = read('app/layout.tsx');
const schema = read('components/seo/schema-markup.tsx');
const middleware = read('middleware.ts');
const pricingSource = read('lib/landing/pricing.ts');
const signup = read('app/(auth)/signup/page.tsx');
const publicCopy = [page, landing, layout, schema, pricingSource].join('\n');

const forbidden = [
    'Join the Waitlist',
    'Waitlist is open',
    'Ultimate SEO',
    'SEO Project Management',
    'Retain 95%',
    '95% more clients',
    'Join 100+ agencies',
    '100+ agencies',
    'Limited beta',
    'Client Retention Radar',
    'how much money you made',
    'No credit card',
    'Kanban Task Board',
    'AI Insights',
    'Unlimited AI Reports',
    'Client Portal',
    'White-labeling',
    'Custom Branding',
    'Custom API Access',
    'SLA Guarantees',
    'Ecoworkz',
    'ecoworkz',
    'Semrush',
    'Northstar',
    'Verified work',
    'On track',
    'Rankings',
    '2,970',
    'aggregateRating',
    'Command Center',
];

test('landing copy matches the locked deck', () => {
    assert.match(landing, /Search data and campaign delivery, together\./);
    assert.match(landing, /See how a client is performing, what the campaign is doing next, and what was actually delivered — without a second spreadsheet or a status-chase email\./);
    assert.match(landing, /Most SEO stacks split the truth\./);
    assert.match(landing, /Data tools show clicks and keywords\./);
    assert.match(landing, /Project tools show tasks and dates\./);
    assert.match(landing, /Clients still ask: what shipped, and did it matter\?/);
    assert.match(landing, /SEO Ops Center is the client workspace in the middle — performance, roadmap, and delivery on the same account\./);
    assert.match(landing, /A live view of search performance/);
    assert.match(landing, /Overview brings Google Search Console and Google Analytics into the client workspace, with the date window and source in view\./);
    assert.match(landing, /A campaign view your team can actually share/);
    assert.match(landing, /Missing data stays "Not yet measurable" — never a fake zero\./);
    assert.match(landing, /Delivery stays on the same account/);
    assert.match(landing, /Start with one client workspace\./);
    assert.match(landing, /14-day free trial\. No waitlist\./);
    assert.match(landing, /© 2026 Marketing Empire Group/);
    assert.match(landing, /Demo workspace · fictional client data/);
    assert.match(landing, /Roadmap and Results tabs · demo workspace · fictional client data/);
    assert.equal(pricingTrialLine, 'All plans include a 14-day free trial.');
    assert.match(landing, /For SEO agencies/);
    assert.match(landing, /Overview · Roadmap · Results/);
});

test('signed-out auth links go to login and trial links go to signup', () => {
    assert.match(landing, /href="\/login"/);
    assert.match(landing, /"\/signup"/);
    assert.match(landing, /href="\/privacy"/);
    assert.match(landing, /href="\/terms"/);
    assert.match(landing, /#performance/);
    assert.match(landing, /#pricing/);
    assert.doesNotMatch(landing, /href="\/dashboard"/);
    assert.match(page, /<Hero/);
    assert.match(page, /<Story/);
    assert.match(page, /<Features/);
    assert.match(page, /<Pricing/);
    assert.match(page, /<CTA/);
});

test('signed-in visitors on / still redirect to the dashboard', () => {
    assert.match(middleware, /pathname === '\/'/);
    assert.match(middleware, /Redirect them to \/dashboard/);
    assert.match(middleware, /new URL\('\/dashboard', request\.url\)/);
});

test('pricing keeps the four live amounts and the stripped feature lists', () => {
    assert.deepEqual(pricingTiers.map(tier => [tier.name, tier.price, tier.cta, tier.href, tier.highlighted]), [
        ['Starter', '49', 'Start free trial', '/signup', false],
        ['Pro', '199', 'Start free trial', '/signup', true],
        ['Agency', '499', 'Start free trial', '/signup', false],
        ['Enterprise', 'Custom', 'Contact sales', '/signup', false],
    ]);
    assert.deepEqual(pricingTiers[0]?.features, [
        'Up to 3 Clients',
        '1 User Account',
        'Basic SEO Dashboard',
        'Tasks',
        'Manual Reports',
        'Community Support',
    ]);
    assert.equal(pricingTiers[1]?.features[0], 'Everything in Starter');
    assert.equal(pricingTiers[2]?.features[0], 'Everything in Pro');
    assert.equal(pricingTiers[3]?.features[0], 'Everything in Agency');
    assert.ok(pricingTiers[1]?.features.includes('Time Tracking'));
    assert.ok(pricingTiers[2]?.features.includes('Priority Support'));
    assert.ok(pricingTiers[3]?.features.includes('Dedicated Account Manager'));
    assert.match(pricingSource, /pricingTiers/);
    assert.match(landing, /pricingTiers\.map/);
});

test('public metadata no longer describes the waitlist page', () => {
    assert.match(page, /SEO Ops Center \| Search data and campaign delivery/);
    assert.match(layout, /SEO Ops Center \| Search data and campaign delivery/);
    assert.match(schema, /"name": "SEO Ops Center"/);
    assert.match(schema, /"price": "49"/);
    assert.match(schema, /"price": "199"/);
    assert.match(schema, /"price": "499"/);
    assert.doesNotMatch(schema, /aggregateRating/);
    assert.doesNotMatch(schema, /"price": "0"/);
});

test('dropped honesty claims are absent from the public landing sources', () => {
    for (const phrase of forbidden) {
        assert.equal(publicCopy.includes(phrase), false, phrase);
    }
});

test('signup does not collect a card, and the landing does not claim that', () => {
    assert.doesNotMatch(signup, /stripe|credit card|payment method|CardElement|checkout\.sessions/i);
    assert.doesNotMatch(publicCopy, /No credit card/);
    assert.doesNotMatch(read('lib/stripe.ts'), /checkout\.sessions\.create/);
});

test('product frames are static fictional Summit Dental shots', () => {
    const shots = [
        'public/marketing/summit-campaign-overview.png',
        'public/marketing/summit-overview.png',
        'public/marketing/summit-roadmap-results.png',
        'public/marketing/summit-tasks.png',
        'public/marketing/summit-campaign-overview-mobile.png',
        'public/marketing/summit-overview-mobile.png',
        'public/marketing/summit-roadmap-mobile.png',
        'public/marketing/summit-results-mobile.png',
        'public/marketing/summit-tasks-mobile.png',
    ];
    for (const shot of shots) {
        const file = new URL(`../../${shot}`, import.meta.url);
        assert.ok(statSync(file).size > 1000, shot);
        assert.match(landing, new RegExp(shot.replace('public', '')));
    }
    assert.match(landing, /fictional client data/);
    assert.doesNotMatch(landing, /iframe/);
});
