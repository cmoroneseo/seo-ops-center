import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const migration=readFileSync(new URL('../../migrations/072_client_agreements.sql',import.meta.url),'utf8');
const org='00000000-0000-0000-0000-000000000010',user='00000000-0000-0000-0000-000000000001',client='00000000-0000-0000-0000-000000000020';
const task1='00000000-0000-0000-0000-000000000030',task2='00000000-0000-0000-0000-000000000031';
async function database() {
    const db=new PGlite();
    await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;
        create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
        create table organizations(id uuid primary key);create table users(id uuid primary key);
        create table organization_members(organization_id uuid,user_id uuid,role text);
        create function get_user_org_ids() returns setof uuid language sql security definer as $$select organization_id from organization_members where user_id=auth.uid()$$;
        create table clients(id uuid primary key,organization_id uuid,name text,seo_hours numeric,blogs_due_per_month numeric,engagement_model text,setup_scope jsonb,status text,launch_date date,onboarding_date date,campaign_start date,campaign_end date,campaign_total_hours numeric);
        create table tasks(id uuid primary key,organization_id uuid,client_id uuid,title text,status text,created_at timestamptz default now());
        create table time_logs(id uuid primary key default gen_random_uuid(),organization_id uuid,client_id uuid,task_id uuid,date date,hours numeric,status text default 'logged',import_status text default 'mapped',counts_toward_budget boolean default true);
        create table deliverable_commitments(id uuid primary key default gen_random_uuid(),organization_id uuid,client_id uuid,type text,title text,subtype text,quantity_per_month numeric,cadence text,engagement_model text,total_quantity int,starts_on date,ends_on date,is_active boolean,counts_toward_hours boolean,custom_fields jsonb);
        create table deliverables(id uuid primary key default gen_random_uuid(),organization_id uuid,client_id uuid,commitment_id uuid,generated_by text);
        create table marketing_plans(id uuid primary key default gen_random_uuid(),organization_id uuid,client_id uuid,title text);
        create table marketing_plan_items(id uuid primary key default gen_random_uuid(),organization_id uuid,client_id uuid,marketing_plan_id uuid,title text,sort_order int);
        create table reports(id uuid primary key default gen_random_uuid(),organization_id uuid,client_id uuid,status text,report_month text);
        create table client_activity_log(id uuid primary key default gen_random_uuid(),organization_id uuid,client_id uuid,event_type text,actor_id uuid,operation_id uuid,metadata jsonb);
        insert into organizations values('${org}');insert into users values('${user}');insert into organization_members values('${org}','${user}','owner');
        insert into clients(id,organization_id,name,seo_hours,status,launch_date) values('${client}','${org}','Scott',10,'active','2020-01-01');
        insert into tasks(id,organization_id,client_id,title,status,created_at) values('${task1}','${org}','${client}','Continue SEO','in_progress','2020-01-01'),('${task2}','${org}','${client}','Owed output','todo','2020-01-02');
        insert into time_logs(organization_id,client_id,task_id,date,hours) values('${org}','${client}','${task1}','2020-01-20',2),('${org}','${client}','${task1}','2020-02-05',3),('${org}','${client}','${task2}','2020-02-05',1);
        grant usage on schema public,auth to authenticated;grant select,insert,update,delete on all tables in schema public to authenticated;
        set test.actor='${user}';
    `);
    await db.exec(migration);
    await db.exec('set role authenticated');
    return db;
}
const original={kind:'initial',previousId:null,title:'Original retainer',startsOn:'2020-01-01',endsOn:'2020-01-31',mode:'monthly',hours:10,hoursMode:'committed',proration:'daily',timezone:'America/Los_Angeles',scope:'SEO optimization',services:[],evidence:null,note:null,fundedTaskIds:[]};
async function preview(db:PGlite,start:string) {return (await db.query<{review:{token:string}}> ('select preview_client_agreement($1,$2) review',[client,start])).rows[0].review;}
async function confirm(db:PGlite,input:Record<string,unknown>,request:string) {const review=await preview(db,input.startsOn as string);return (await db.query<{id:string}>('select confirm_client_agreement($1,$2,$3,$4) id',[client,request,input,review.token])).rows[0].id;}
test('original and renewed terms are atomic, idempotent, and effective-dated without rewriting prior work',async()=>{
    const db=await database();try{
        const firstRequest='00000000-0000-0000-0000-000000000040';
        const old=await confirm(db,original,firstRequest);
        assert.equal(await confirm(db,original,firstRequest),old);
        assert.equal((await db.query<{n:number}>('select count(*)::int n from client_agreements')).rows[0].n,1);
        const input={...original,kind:'renewal',previousId:old,title:'Renewed 20 hours',startsOn:'2020-02-01',endsOn:null,hours:20,fundedTaskIds:[task1]};
        const renewed=await confirm(db,input,'00000000-0000-0000-0000-000000000041');
        const logs=(await db.query<{date:string;task_id:string;agreement_id:string}>('select date::text,task_id,agreement_id from time_logs order by date,task_id')).rows;
        assert.equal(logs[0].agreement_id,old);assert.equal(logs[1].agreement_id,renewed);assert.equal(logs[2].agreement_id,old);
        assert.equal((await db.query<{ends_on:string}>('select ends_on::text from client_agreements where id=$1',[old])).rows[0].ends_on,'2020-01-31');
        assert.equal((await db.query<{launch_date:string}>('select launch_date::text from clients')).rows[0].launch_date,'2020-01-01');
        await assert.rejects(confirm(db,{...input,hours:25},'00000000-0000-0000-0000-000000000041'),/different terms/);
        await assert.rejects(db.query('update clients set seo_hours=20'),/Manage agreements/);
        await assert.rejects(db.query('update client_agreements set hours=99'),/permission denied/);
        await assert.rejects(db.query('delete from client_agreements'),/permission denied/);
    }finally{await db.close();}
});
test('stale reviews, invalid successors, forbidden roles and invalid service writes cannot partially save',async()=>{
    const db=await database();try{
        const review=await preview(db,original.startsOn);await db.query("update tasks set title='Changed after preview' where id=$1",[task1]);
        await assert.rejects(db.query('select confirm_client_agreement($1,$2,$3,$4)',[client,'00000000-0000-0000-0000-000000000040',original,review.token]),/out of date/);
        const old=await confirm(db,original,'00000000-0000-0000-0000-000000000040');
        const invalid={...original,kind:'renewal',previousId:old,startsOn:'2020-02-01',endsOn:null,services:[{title:'Bad quantity',type:'Content',quantity:1.5,cadence:'monthly'}]};
        await assert.rejects(confirm(db,invalid,'00000000-0000-0000-0000-000000000041'),/Invalid deliverable/);
        assert.equal((await db.query<{n:number}>('select count(*)::int n from client_agreements')).rows[0].n,1);
        await assert.rejects(confirm(db,{...invalid,services:[],startsOn:'2020-01-15'},'00000000-0000-0000-0000-000000000041'),/Renewal must follow/);
        await db.exec("reset role;update organization_members set role='member';set role authenticated");
        await assert.rejects(preview(db,'2020-02-01'),/owners and admins/);
        await db.exec('reset role;set role anon');await assert.rejects(preview(db,'2020-02-01'),/permission denied/);
    }finally{await db.close();}
});
test('tenant isolation and scheduled cancellation restore prior coverage without removing accepted evidence',async()=>{
    const db=await database();try{
        const old=await confirm(db,{...original,endsOn:'2099-01-31'},'00000000-0000-0000-0000-000000000040');
        const next=await confirm(db,{...original,kind:'renewal',previousId:old,startsOn:'2099-02-01',endsOn:null},'00000000-0000-0000-0000-000000000041');
        await db.query('select cancel_scheduled_agreement($1,$2)',[client,next]);
        assert.equal((await db.query<{n:number}>('select count(*)::int n from client_agreements where cancelled_at is not null')).rows[0].n,1);
        await assert.rejects(db.query('select cancel_scheduled_agreement($1,$2)',[client,old]),/latest future/);
        await db.exec("set test.actor='00000000-0000-0000-0000-000000000099'");
        assert.equal((await db.query<{n:number}>('select count(*)::int n from client_agreements')).rows[0].n,0);
        await assert.rejects(preview(db,'2020-02-01'),/owners and admins/);
    }finally{await db.close();}
});
test('multiple renewals retain each unfinished task funding decision and snapshot accepted outputs',async()=>{
    const db=await database();try{
        const initial=await confirm(db,{...original,services:[{title:'Content pieces',type:'Content',quantity:2,cadence:'monthly',countsTowardHours:false}]},'00000000-0000-0000-0000-000000000040');
        const second=await confirm(db,{...original,kind:'renewal',previousId:initial,startsOn:'2020-02-01',endsOn:'2020-02-29',fundedTaskIds:[task1]},'00000000-0000-0000-0000-000000000041');
        await confirm(db,{...original,kind:'renewal',previousId:second,startsOn:'2020-03-01',endsOn:null},'00000000-0000-0000-0000-000000000042');
        await db.query('insert into time_logs(organization_id,client_id,task_id,date,hours) values($1,$2,$3,$4,1)',[org,client,task1,'2020-03-05']);
        await db.query('insert into time_logs(organization_id,client_id,task_id,date,hours) values($1,$2,$3,$4,1)',[org,client,task2,'2020-03-05']);
        const logs=(await db.query<{task_id:string;agreement_id:string}>("select task_id,agreement_id from time_logs where date='2020-03-05' order by task_id")).rows;
        assert.equal(logs[0].agreement_id,second);assert.equal(logs[1].agreement_id,initial);
        await assert.rejects(db.exec('update deliverable_commitments set quantity_per_month=9'),/Change scope/);
        await assert.rejects(db.exec('delete from deliverable_commitments'),/cannot be deleted/);
    }finally{await db.close();}
});
test('first-month onboarding effort is attributed without moving its recorded date',async()=>{
    const db=await database();try{
        await db.query("update clients set onboarding_date='2019-12-01',setup_scope=$1",[{onboardingBudget:'first_month'}]);
        await db.query("insert into time_logs(organization_id,client_id,date,hours) values($1,$2,'2019-12-15',2)",[org,client]);
        const initial=await confirm(db,original,'00000000-0000-0000-0000-000000000040');
        const log=(await db.query<{date:string;agreement_id:string}>("select date::text,agreement_id from time_logs where date='2019-12-15'")).rows[0];
        assert.equal(log.agreement_id,initial);assert.equal(log.date,'2019-12-15');
    }finally{await db.close();}
});
test('the migration is mirrored in the full schema',()=>{
    assert.ok(readFileSync(new URL('../../schema.sql',import.meta.url),'utf8').includes(migration));
});
test('scope amendments retain unchanged outputs and add only the unissued custom difference',async()=>{
    const db=await database();try{
        const services=[{title:'Technical reviews',type:'Other',quantity:3,cadence:'one_time',countsTowardHours:true}];
        const first=await confirm(db,{...original,mode:'custom',hoursMode:'allowance',hours:30,services},'00000000-0000-0000-0000-000000000040');
        const output=(await db.query<{id:string}>('select id from deliverable_commitments')).rows[0].id;
        await db.query('insert into deliverables(organization_id,client_id,commitment_id) select $1,$2,$3 from generate_series(1,3)',[org,client,output]);
        const changed={...original,mode:'custom',hoursMode:'allowance',hours:20,kind:'amendment',previousId:first,startsOn:'2020-01-15',services:[{...services[0],sourceId:output}]};
        const second=await confirm(db,changed,'00000000-0000-0000-0000-000000000041');
        assert.equal((await db.query<{n:number}>('select count(*)::int n from deliverable_commitments')).rows[0].n,1);
        await confirm(db,{...changed,previousId:second,startsOn:'2020-01-20',services:[{...services[0],sourceId:output,quantity:5}]},'00000000-0000-0000-0000-000000000042');
        assert.equal((await db.query<{n:number}>('select total_quantity n from deliverable_commitments where agreement_id<>$1',[first])).rows[0].n,2);
        await assert.rejects(db.query('insert into deliverable_commitments(organization_id,client_id,agreement_id,title) values($1,$2,$3,$4)',[org,client,first,'Undeclared output']),/Change scope/);
    }finally{await db.close();}
});
test('custom cron writes reject stale scopes and cannot exceed a revised total',async()=>{
    const db=await database();try{
        const today=(await db.query<{today:string}>("select (now() at time zone 'America/Los_Angeles')::date::text as today")).rows[0].today;
        const services=[{title:'Technical reviews',type:'Other',quantity:3,cadence:'one_time',countsTowardHours:true}];
        const first=await confirm(db,{...original,endsOn:'2099-12-31',mode:'custom',hoursMode:'allowance',hours:30,services},'00000000-0000-0000-0000-000000000040');
        const output=(await db.query<{id:string}>('select id from deliverable_commitments')).rows[0].id;
        await db.query("insert into deliverables(organization_id,client_id,commitment_id,generated_by) select $1,$2,$3,'cron' from generate_series(1,3)",[org,client,output]);
        await confirm(db,{...original,endsOn:'2099-12-31',mode:'custom',hoursMode:'allowance',kind:'amendment',previousId:first,startsOn:today,services:[{...services[0],sourceId:output,quantity:5}]},'00000000-0000-0000-0000-000000000041');
        await db.query("insert into deliverables(organization_id,client_id,commitment_id,generated_by) values($1,$2,$3,'cron')",[org,client,output]);
        assert.equal((await db.query<{n:number}>('select count(*)::int n from deliverables')).rows[0].n,3);
        const revised=(await db.query<{id:string}>('select id from deliverable_commitments where id<>$1',[output])).rows[0].id;
        await db.query("insert into deliverables(organization_id,client_id,commitment_id,generated_by) select $1,$2,$3,'cron' from generate_series(1,8)",[org,client,revised]);
        assert.equal((await db.query<{n:number}>('select count(*)::int n from deliverables')).rows[0].n,5);
        await assert.rejects(db.query("update deliverable_commitments set custom_fields=jsonb_set(custom_fields,'{agreedTotalQuantity}','99') where id=$1",[revised]),/Change scope/);
    }finally{await db.close();}
});
