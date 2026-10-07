import test from 'node:test';
import assert from 'node:assert/strict';
import { agreementForDate, agreementPeriod, validateAgreement, agreementHoursSummary, agreementLabel,monthlyAgreementLogs,monthlyAgreementTaskIds } from './logic';
import type { ClientAgreement, AgreementInput } from './types';
const original: ClientAgreement = {id:'old', organizationId:'org',clientId:'client',previousId:null,kind:'initial',title:'Original retainer',startsOn:'2026-03-19',endsOn:'2026-09-19',mode:'monthly',hours:30,hoursMode:'committed',proration:'daily',timezone:'America/Los_Angeles',scope:'SEO',services:[],evidence:null,note:null,recordedAt:'2026-10-06',recordedBy:'owner',planSnapshot:null};
const renewed: ClientAgreement = {...original,id:'new',previousId:'old',kind:'renewal',title:'Custom renewal',startsOn:'2026-09-20',endsOn:null,mode:'custom',hours:40,hoursMode:'estimate'};
test('renewal retains old months and separates custom effort from monthly allowance',()=>{
    assert.equal(agreementForDate([original,renewed],'2026-08-01')?.id,'old');
    assert.equal(agreementForDate([original,renewed],'2026-09-20')?.id,'new');
    const september=agreementPeriod([original,renewed],'2026-09');
    assert.equal(september.monthlyBudget,19); assert.equal(september.mixed,true);
    assert.equal(september.segments[1].budget,null); assert.equal(september.uncoveredDays,0);
    assert.equal(agreementLabel(renewed),'Custom scope');
});
test('September 1 upscope preserves prior allocation; effective date is independent of recorded date',()=>{
    const before={...original,endsOn:'2026-08-31',hours:10};
    const after={...renewed,mode:'monthly' as const,hoursMode:'allowance' as const,hours:20,startsOn:'2026-09-01'};
    assert.equal(agreementPeriod([before,after],'2026-08').monthlyBudget,10);
    assert.equal(agreementPeriod([before,after],'2026-09').monthlyBudget,20);
});
test('amendment prorates both segments, keeps signed terms, and reports gaps honestly',()=>{
    const before={...original,startsOn:'2026-09-01',endsOn:'2026-12-31',hours:10};
    const after={...before,id:'amended',previousId:'old',kind:'amendment' as const,startsOn:'2026-09-16',hours:20};
    assert.equal(agreementPeriod([before,after],'2026-09').monthlyBudget,15);
    assert.equal(before.endsOn,'2026-12-31');
    assert.equal(agreementForDate([{...before,endsOn:'2026-09-10'}],'2026-09-11'),null);
    assert.equal(agreementPeriod([{...before,endsOn:'2026-09-10'}],'2026-09').uncoveredDays,20);
    assert.equal(agreementPeriod([{...before,proration:'full_period'}, {...after,proration:'full_period'}],'2026-09').monthlyBudget,30);
});
test('scope hours stay attributed to origin; unknown and non-budget time do not contaminate gauges',()=>{
    const result=agreementHoursSummary([original,renewed],'2026-09',[
        {date:'2026-09-05',hours:8,agreementId:'old',countsTowardBudget:true},
        {date:'2026-09-25',hours:3,agreementId:'old',countsTowardBudget:true},
        {date:'2026-09-25',hours:2,agreementId:'new',countsTowardBudget:true},
        {date:'2026-09-25',hours:1,agreementId:null,countsTowardBudget:true},
        {date:'2026-09-25',hours:50,agreementId:'new',countsTowardBudget:false},
    ]);
    assert.equal(result.rows[0].periodLogged,11);assert.equal(result.rows[1].periodLogged,2);assert.equal(result.unassigned,1);
});
test('invalid dates, omitted units, mismatched custom/monthly semantics and quantities are rejected',()=>{
    const valid:AgreementInput={...original,kind:'initial',fundedTaskIds:[]};
    assert.equal(validateAgreement(valid),null);
    assert.match(validateAgreement({...valid,startsOn:'2026-02-30'})!,/date/i);
    assert.match(validateAgreement({...valid,hours:null})!,/hours/i);
    assert.match(validateAgreement({...valid,mode:'custom',hoursMode:'committed'})!,/estimate|allowance/i);
    assert.match(validateAgreement({...valid,endsOn:'2020-01-01'})!,/end/i);
    assert.match(validateAgreement({...valid,services:[{title:'Blogs',type:'Content',quantity:1.5,cadence:'monthly',countsTowardHours:false}]})!,/whole/i);
    assert.match(validateAgreement({...valid,timezone:'not/a/timezone'})!,/time zone/i);
});
test('late prior work has no new monthly allowance; onboarding allocation preserves the actual work date',()=>{
    const logs=[{date:'2026-10-05',hours:3,agreementId:'old',countsTowardBudget:true},{date:'2026-10-05',hours:4,agreementId:'new',countsTowardBudget:true}];
    const summary=agreementHoursSummary([original,renewed],'2026-10',logs);
    assert.equal(summary.rows.find(row=>row.agreement.id==='old')?.budget,null);
    assert.deepEqual(monthlyAgreementLogs(logs,[original,renewed],'2026-10'),[]);
    const onboarding={date:'2026-02-25',budgetMonth:'2026-03',hours:2,agreementId:'old',countsTowardBudget:true};
    assert.equal(agreementHoursSummary([original],'2026-03',[onboarding]).rows[0].periodLogged,2);
    assert.equal(onboarding.date,'2026-02-25');
});
test('monthly planning excludes prior owed work and honors cancelled funding decisions',()=>{
    const monthly={...renewed,mode:'monthly' as const,hoursMode:'allowance' as const,hours:20};
    const tasks=[{id:'owed',agreementId:'old'},{id:'funded',agreementId:'old'},{id:'new-work',agreementId:'new'}];
    const funding=[{taskId:'funded',agreementId:'new',transitionId:'new',effectiveOn:'2026-09-20',recordedAt:'2026-10-06'}];
    assert.deepEqual(monthlyAgreementTaskIds(tasks,[original,monthly],funding,'2026-10'),['funded','new-work']);
    assert.deepEqual(monthlyAgreementTaskIds(tasks,[original,{...monthly,cancelledAt:'2026-09-01'}],funding,'2026-10'),[]);
});
