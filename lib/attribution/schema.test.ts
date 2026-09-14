import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const org = '11111111-1111-1111-1111-111111111111';
const otherOrg = '22222222-2222-2222-2222-222222222222';
const client = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const otherClient = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const untrackedClient = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbc';
const site = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const otherSite = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const migration = readFileSync('migrations/056_attribution.sql', 'utf8');
const hardeningMigration = readFileSync('migrations/057_attribution_hardening.sql', 'utf8');
const canaryMigration = readFileSync('migrations/058_attribution_canary_integrity.sql', 'utf8');
const advisorMigration = readFileSync('migrations/059_attribution_advisor_fixes.sql', 'utf8');

before(async () => {
    await db.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create table public.organizations(id uuid primary key);
        create table public.clients(id uuid primary key, organization_id uuid references organizations(id));
        create function public.get_user_org_ids() returns setof uuid language sql stable as $$
            select nullif(current_setting('test.org', true), '')::uuid $$;
        grant all on organizations, clients to service_role;
        insert into organizations values ('${org}'), ('${otherOrg}');
        insert into clients values ('${client}', '${org}'), ('${otherClient}', '${otherOrg}'), ('${untrackedClient}', '${otherOrg}');
    `);
    await db.exec(migration);
    await db.exec(hardeningMigration);
    await db.exec(canaryMigration);
    await db.exec(advisorMigration);
    await db.query('insert into attribution_enabled_organizations(organization_id) values ($1)', [org]);
    await db.query(`insert into attribution_sites(id, organization_id, client_id, domain)
        values ($1, $2, $3, 'example.com'), ($4, $5, $6, 'other.com')`, [site, org, client, otherSite, otherOrg, otherClient]);
});
after(async () => { await db.close(); });

async function role(value = 'service_role', organization = org) {
    await db.exec(`reset role; set role ${value}; set test.org = '${organization}'`);
}

function insertEvent(id: string, type = 'form_submit', source = 'organic_google', domain = 'example.com', page = '/contact') {
    return db.query(`insert into attribution_events
        (id, client_event_id, organization_id, site_id, site_domain, event_type, session_id, visitor_id, source_category, landing_page, page_url)
        values ($1::uuid,$1::text,$2,$3,$4,$5,'same-session','same-visitor',$6,'https://example.com/services',$7)`,
    [id, org, site, domain, type, source, `https://${domain}${page}`]);
}

test('migration 056 is mirrored exactly in schema.sql', () => {
    const start = '-- 1. Add avg_deal_value to clients';
    const end = '-- 057 attribution hardening';
    const schema = readFileSync('schema.sql', 'utf8');
    assert.equal(schema.slice(schema.indexOf(start), schema.indexOf(end)).trim(), migration.slice(migration.indexOf(start)).trim());
    const canaryStart = '-- 058 attribution canary integrity';
    const advisorStart = '-- 059 attribution advisor fixes';
    assert.equal(schema.slice(schema.indexOf(end), schema.indexOf(canaryStart)).trim(), hardeningMigration.slice(hardeningMigration.indexOf(end)).trim());
    assert.equal(schema.slice(schema.indexOf(canaryStart), schema.indexOf(advisorStart)).trim(), canaryMigration.slice(canaryMigration.indexOf(canaryStart)).trim());
    assert.equal(schema.slice(schema.indexOf(advisorStart)).trim(), advisorMigration.slice(advisorMigration.indexOf(advisorStart)).trim());
});

test('distributed limiter counts events per IP and site in atomic minute buckets', async () => {
    await role();
    assert.equal((await db.query("select check_attribution_rate_limit($1,$2,$3)", [site, 'ip-a', 50])).rows[0].check_attribution_rate_limit, true);
    assert.equal((await db.query("select check_attribution_rate_limit($1,$2,$3)", [site, 'ip-a', 50])).rows[0].check_attribution_rate_limit, true);
    assert.equal((await db.query("select check_attribution_rate_limit($1,$2,$3)", [site, 'ip-a', 1])).rows[0].check_attribution_rate_limit, false);
    for (let index = 0; index < 8; index++) {
        assert.equal((await db.query("select check_attribution_rate_limit($1,$2,$3)", [site, `ip-${index}`, 50])).rows[0].check_attribution_rate_limit, true);
    }
    assert.equal((await db.query("select check_attribution_rate_limit($1,$2,$3)", [site, 'ip-over-site-limit', 1])).rows[0].check_attribution_rate_limit, false);
});

test('canary policy blocks attribution site creation outside enabled organizations', async () => {
    await role('authenticated', otherOrg);
    assert.equal((await db.query('select organization_id from attribution_enabled_organizations')).rows.length, 0);
    await assert.rejects(db.query(`insert into attribution_sites(organization_id, client_id, domain)
        values ($1,$2,'disabled.example')`, [otherOrg, untrackedClient]), /row-level security policy/);
    await role('authenticated', org);
    assert.equal((await db.query('select organization_id from attribution_enabled_organizations')).rows.length, 1);
});

test('client event ids make ambiguous retries idempotent', async () => {
    await role();
    const eventId = '00000000-0000-4000-8000-000000000090';
    await insertEvent(eventId);
    await db.query(`insert into attribution_events
        (id, client_event_id, organization_id, site_id, site_domain, event_type, session_id, visitor_id, source_category, landing_page, page_url)
        values ('00000000-0000-4000-8000-000000000091',$1,$2,$3,'example.com','form_submit','same-session','same-visitor','organic_google','https://example.com/services','https://example.com/contact')
        on conflict (site_id, client_event_id) do nothing`, [eventId, org, site]);
    assert.equal((await db.query('select count(*)::int as count from attribution_events where client_event_id=$1', [eventId])).rows[0].count, 1);
    assert.equal((await db.query('select count(*)::int as count from attribution_conversions c join attribution_events e on e.id=c.event_id where e.client_event_id=$1', [eventId])).rows[0].count, 1);
    await db.query('delete from attribution_events where client_event_id=$1', [eventId]);
});

test('tenant ownership is enforced structurally for site inserts, updates, and client reassignment', async () => {
    await role('authenticated');
    await assert.rejects(db.query(`insert into attribution_sites(organization_id, client_id, domain) values ($1,$2,'victim.com')`,
        [org, untrackedClient]), /foreign key constraint/);
    await role();
    await assert.rejects(db.query(`update attribution_sites set organization_id=$1 where id=$2`, [otherOrg, site]), /foreign key constraint/);
    await assert.rejects(db.query(`update clients set organization_id=$1 where id=$2`, [otherOrg, client]), /foreign key constraint/);
});

test('RLS limits site/event reads and denies anonymous and member event/conversion writes', async () => {
    await role('authenticated', otherOrg);
    assert.equal((await db.query('select id from attribution_sites where id=$1', [site])).rows.length, 0);
    await assert.rejects(insertEvent('00000000-0000-4000-8000-000000000001'), /permission denied/);
    await assert.rejects(db.query(`insert into attribution_conversions default values`), /permission denied/);
    await role('anon');
    await assert.rejects(db.query('select * from attribution_sites'), /permission denied/);
    await assert.rejects(db.query('select * from attribution_events'), /permission denied/);
});

test('domain and category constraints reject invalid direct database writes', async () => {
    await role();
    for (const domain of ['WWW.EXAMPLE.COM', 'example.com:443', 'example.com?x=1', 'example.com#fragment', 'bad_domain.com']) {
        await assert.rejects(db.query('update attribution_sites set domain=$1 where id=$2', [domain, site]), /check constraint/);
    }
    await assert.rejects(insertEvent('00000000-0000-4000-8000-000000000002', 'form_submit', 'https://google.com/'), /check constraint/);
    await assert.rejects(db.query(`insert into attribution_events
        (client_event_id,organization_id,site_id,site_domain,event_type,session_id,visitor_id,source_category,page_url)
        values ('wrong-org',$1,$2,'example.com','pageview','s','v','direct','/')`, [otherOrg, site]), /foreign key constraint/);
});

test('concurrent same-visitor receipts materialize only their own exact events and enforce uniqueness', async () => {
    await role();
    await Promise.all([
        insertEvent('00000000-0000-4000-8000-000000000010', 'form_submit', 'paid', 'example.com', '/form'),
        insertEvent('00000000-0000-4000-8000-000000000011', 'tel_click', 'direct', 'example.com', '/phone'),
    ]);
    const conversions = (await db.query(`select event_id, conversion_type, source_category, page_url, client_id,
        (month=date_trunc('month',created_at at time zone 'UTC')::date) as correct_month
        from attribution_conversions order by event_id`)).rows;
    assert.deepEqual(conversions, [
        { event_id: '00000000-0000-4000-8000-000000000010', conversion_type: 'form', source_category: 'paid', page_url: 'https://example.com/form', client_id: client, correct_month: true },
        { event_id: '00000000-0000-4000-8000-000000000011', conversion_type: 'phone', source_category: 'direct', page_url: 'https://example.com/phone', client_id: client, correct_month: true },
    ]);
    await assert.rejects(db.query(`insert into attribution_conversions
        (organization_id,site_id,client_id,event_id,conversion_type,source_category,page_url,month)
        select organization_id,site_id,client_id,event_id,conversion_type,source_category,page_url,month
        from attribution_conversions limit 1`), /unique constraint/);
    await assert.rejects(db.query(`update attribution_conversions set organization_id=$1,site_id=$2,client_id=$3
        where event_id='00000000-0000-4000-8000-000000000010'`, [otherOrg, otherSite, otherClient]), /foreign key constraint/);
    await role('authenticated', otherOrg);
    assert.equal((await db.query('select id from attribution_events')).rows.length, 0);
    assert.equal((await db.query('select id from attribution_conversions')).rows.length, 0);
});

test('a failed conversion rolls back the complete event batch and verification', async () => {
    await db.exec(`reset role;
        update attribution_sites set verified_at=null where id='${site}';
        create function public.test_reject_conversion() returns trigger language plpgsql as $$
        begin if new.page_url='/reject' then raise exception 'test conversion failure'; end if; return new; end $$;
        create trigger test_conversion_failure before insert on attribution_conversions
        for each row execute function public.test_reject_conversion();`);
    await role();
    try {
        await assert.rejects(db.query(`insert into attribution_events
            (client_event_id,organization_id,site_id,site_domain,event_type,session_id,visitor_id,source_category,page_url)
            values ('rollback-okay',$1,$2,'example.com','form_submit','rollback','v','direct','/okay'),
                   ('rollback-reject',$1,$2,'example.com','form_submit','rollback','v','direct','/reject')`, [org, site]), /test conversion failure/);
        assert.equal((await db.query(`select id from attribution_events where session_id='rollback'`)).rows.length, 0);
        assert.equal((await db.query(`select id from attribution_conversions where page_url in ('/okay','/reject')`)).rows.length, 0);
        assert.equal((await db.query('select verified_at from attribution_sites where id=$1', [site])).rows[0].verified_at, null);
    } finally {
        await db.exec('reset role; drop trigger test_conversion_failure on attribution_conversions; drop function public.test_reject_conversion();');
    }
});

test('only a real event verifies a site; a domain change clears it and rejects old queued events', async () => {
    await role('authenticated');
    await assert.rejects(db.query('update attribution_sites set verified_at=now() where id=$1', [site]), /permission denied/);
    await role();
    await insertEvent('00000000-0000-4000-8000-000000000030', 'pageview');
    assert.ok((await db.query('select verified_at from attribution_sites where id=$1', [site])).rows[0].verified_at);
    await role('authenticated');
    await db.query("update attribution_sites set domain='new.example.com' where id=$1", [site]);
    assert.equal((await db.query('select verified_at from attribution_sites where id=$1', [site])).rows[0].verified_at, null);
    await role();
    await assert.rejects(insertEvent('00000000-0000-4000-8000-000000000031', 'pageview'), /site changed/);
    await insertEvent('00000000-0000-4000-8000-000000000032', 'pageview', 'direct', 'new.example.com');
    assert.ok((await db.query('select verified_at from attribution_sites where id=$1', [site])).rows[0].verified_at);
    assert.equal((await db.query('select id from attribution_conversions')).rows.length, 2);
});
