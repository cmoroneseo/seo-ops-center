import test from 'node:test';
import assert from 'node:assert/strict';
import { agreementForDate, agreementPeriod, agreementCoverageEnd, validateAgreement, validateAgreementChain, agreementHoursSummary, agreementLabel,monthlyAgreementLogs,monthlyAgreementTaskIds,reviewMonthQuota,reviewAgreements,monthCoverageLines,outputDiff,stoppingOutputs,formatHourQuota,formatHoursAgainstQuota,agreementDialogTitle,allowanceReconciliation,clientCurrentSetup,historicalHoursNote,agreementHistoryHeading,NO_AGREEMENT_RECORDED,agreementFormInput,dateInputValue,coerceAgreementDates } from './logic';
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
test('a September 19 custom renewal keeps the prorated monthly slice and does not invent a later quota',()=>{
    const before={...original,startsOn:'2026-01-01',endsOn:'2026-09-18',hours:20};
    const after={...renewed,startsOn:'2026-09-19',hours:null,hoursMode:'estimate' as const};
    assert.equal(agreementForDate([before,after],'2026-09-18')?.id,'old');
    assert.equal(agreementForDate([before,after],'2026-09-19')?.id,'new');
    assert.equal(agreementPeriod([before,after],'2026-09').monthlyBudget,12);
    assert.equal(agreementPeriod([before,after],'2026-10').monthlyBudget,null);
    assert.equal(reviewMonthQuota([before],{...after,kind:'renewal',previousId:'old',fundedTaskIds:[]}),12);
    const blogs={sourceId:'blog',title:'Blogs',type:'Content' as const,quantity:2,cadence:'monthly' as const,countsTowardHours:false};
    assert.equal(stoppingOutputs([blogs],[{...blogs,cadence:'one_time'}]).length,1);
    assert.equal(stoppingOutputs([blogs],[{...blogs,title:'Articles'}]).length,0);
});
test('monthly planning excludes prior owed work and honors cancelled funding decisions',()=>{
    const monthly={...renewed,mode:'monthly' as const,hoursMode:'allowance' as const,hours:20};
    const tasks=[{id:'owed',agreementId:'old'},{id:'funded',agreementId:'old'},{id:'new-work',agreementId:'new'}];
    const funding=[{taskId:'funded',agreementId:'new',transitionId:'new',effectiveOn:'2026-09-20',recordedAt:'2026-10-06'}];
    assert.deepEqual(monthlyAgreementTaskIds(tasks,[original,monthly],funding,'2026-10'),['funded','new-work']);
    assert.deepEqual(monthlyAgreementTaskIds(tasks,[original,{...monthly,cancelledAt:'2026-09-01'}],funding,'2026-10'),[]);
});
test('supersede, end, and renew are explicit, and a gap is not a zero budget',()=>{
    const before={...original,startsOn:'2026-01-01',endsOn:null,hours:20};
    const input:AgreementInput={...before,kind:'supersede',previousId:'old',title:'Custom SEO',startsOn:'2026-09-19',endsOn:null,mode:'custom',hours:null,hoursMode:'estimate',scope:'Custom',services:[],fundedTaskIds:[]};
    const today='2026-10-13';
    assert.equal(validateAgreementChain([before],input,today),null);
    assert.match(validateAgreementChain([before],{...input,kind:'renewal'},today)!,/Renewal must follow/);
    assert.match(validateAgreementChain([before],{...input,startsOn:'2026-01-01'},today)!,/follow the previous/);
    assert.equal(validateAgreementChain([{...before,endsOn:'2026-09-18'}],{...input,kind:'renewal'},today),null);
    assert.match(validateAgreementChain([{...before,endsOn:'2026-09-18'}],input,today)!,/Use Renew/);
    assert.equal(validateAgreementChain([before],{...input,kind:'end',startsOn:'2026-01-01',endsOn:'2026-09-30'},today),null);
    assert.match(validateAgreementChain([{...before,endsOn:'2026-12-31'}],{...input,kind:'end',endsOn:'2026-11-30'},today)!,/already has a signed end/);
    assert.equal(validateAgreement({...input,kind:'end',endsOn:'2026-09-30'}),null);
    const reviewed=reviewAgreements([before],input);
    assert.equal(before.endsOn,null);
    assert.equal(agreementCoverageEnd(reviewed[0],reviewed),'2026-09-18');
    assert.deepEqual(monthCoverageLines([before],input).map(line=>line.text),['Sep 1–18 · 12h prorated retainer · 18 days','Sep 19–30 · Custom allowance']);
    assert.equal(reviewMonthQuota([before],input),12);
    assert.equal(agreementPeriod(reviewed,'2026-10').monthlyBudget,null);
    assert.equal(formatHourQuota(null),'—');
    assert.equal(formatHourQuota(0),'0h');
    assert.equal(formatHoursAgainstQuota(4,null),'4 / —');
    assert.equal(formatHoursAgainstQuota(null,12),'—');
    assert.equal(formatHoursAgainstQuota(4,12),'4 / 12h');
    const blogs={sourceId:'blog',title:'Blogs',type:'Content' as const,quantity:2,cadence:'monthly' as const,countsTowardHours:false};
    const diff=outputDiff([blogs],[{...blogs,title:'Articles'},{title:'Audit',type:'Other',quantity:1,cadence:'one_time',countsTowardHours:false}]);
    assert.equal(diff.renamed.length,1);
    assert.equal(diff.kept.length,0);
    assert.equal(diff.added.length,1);
    assert.equal(diff.stopped.length,0);
    const forked=outputDiff([blogs],[{...blogs,quantity:4}]);
    assert.equal(forked.stopped.length,1);
    assert.equal(forked.added.length,1);
    const gapped={...before,endsOn:'2026-09-10'};
    const gapLines=monthCoverageLines([gapped],{...input,kind:'renewal',startsOn:'2026-09-20'}).map(line=>line.text);
    assert.deepEqual(gapLines,['Sep 1–10 · 6.67h prorated retainer · 10 days','Sep 11–19 · Not covered','Sep 20–30 · Custom allowance']);
    assert.equal(diff.carried.length,0);
});
test('a fully covered month is a retainer, and prorated is only a partial slice',()=>{
    const full:AgreementInput={...original,kind:'initial',previousId:null,title:'Original agreement',startsOn:'2026-03-01',endsOn:null,hours:10,scope:'SEO',services:[],fundedTaskIds:[]};
    assert.deepEqual(monthCoverageLines([],full).map(line=>line.text),['Mar 1–31 · 10h retainer']);
    assert.equal(monthCoverageLines([],full).some(line=>/prorated/i.test(line.text)),false);
    const partial:AgreementInput={...full,startsOn:'2026-03-19',hours:30};
    assert.deepEqual(monthCoverageLines([],partial).map(line=>line.text),['Mar 1–18 · Not covered','Mar 19–31 · 12.58h prorated retainer · 13 days']);
    const fullPeriod:AgreementInput={...full,proration:'full_period',startsOn:'2026-03-19',hours:10};
    assert.equal(monthCoverageLines([],fullPeriod).some(line=>/prorated/i.test(line.text)),false);
    assert.match(monthCoverageLines([],fullPeriod).at(-1)!.text,/full-period allowance/);
});
test('prefilled setup outputs are carried over, not added, on an original agreement',()=>{
    const blogs={sourceId:'blog',title:'Blog Posts',type:'Content' as const,quantity:4,cadence:'monthly' as const,countsTowardHours:true};
    const fresh={title:'Audit',type:'Other' as const,quantity:1,cadence:'one_time' as const,countsTowardHours:false};
    const diff=outputDiff(undefined,[blogs,fresh]);
    assert.deepEqual(diff.carried.map(service=>service.title),['Blog Posts']);
    assert.deepEqual(diff.added.map(service=>service.title),['Audit']);
    assert.equal(outputDiff([blogs],[blogs]).carried.length,0);
    assert.equal(outputDiff([blogs],[blogs]).added.length,0);
    assert.equal(outputDiff([blogs],[blogs]).kept.length,1);
});
test('original review reconciles the current monthly allowance and names where historical hours count',()=>{
    assert.equal(agreementDialogTitle('initial',false),'Record agreement');
    assert.equal(agreementDialogTitle('initial',true),'Review agreement');
    const current=clientCurrentSetup({engagementModel:'Retainer',seoHours:30,setupScope:{mode:'monthly'}});
    assert.deepEqual(current,{mode:'monthly',hours:30});
    const same=allowanceReconciliation(current,{mode:'monthly',hours:30});
    assert.equal(same.text,'Current setup: 30h / month → Agreement: 30h / month');
    assert.equal(same.mismatch,false);
    const changed=allowanceReconciliation(current,{mode:'monthly',hours:20});
    assert.equal(changed.text,'Current setup: 30h / month → Agreement: 20h / month');
    assert.equal(changed.mismatch,true);
    const custom=allowanceReconciliation(current,{mode:'custom',hours:null});
    assert.equal(custom.mismatch,true);
    assert.match(custom.text,/Custom scope/);
    const unknown=allowanceReconciliation({mode:null,hours:null},{mode:'monthly',hours:30});
    assert.equal(unknown.text,'Current setup: — → Agreement: 30h / month');
    assert.equal(unknown.mismatch,false);
    assert.deepEqual(clientCurrentSetup({engagementModel:'Campaign',campaignConfig:{totalHours:0}}),{mode:'custom',hours:null});
    const note=historicalHoursNote({hours:148.27,startsOn:'2026-03-19',endsOn:null,agreementTitle:'Original agreement',previousTitle:null,kind:'initial'});
    assert.match(note,/148\.27 confirmed budget hours recorded on or after Mar 19, 2026 count against Original agreement/);
    assert.match(note,/Budgets for those months will follow the recorded terms/);
    assert.equal(historicalHoursNote({hours:null,startsOn:'2026-03-19',endsOn:null,agreementTitle:'Original agreement',previousTitle:null,kind:'initial'}).includes('0 confirmed'),false);
    assert.match(historicalHoursNote({hours:0,startsOn:'2026-03-19',endsOn:null,agreementTitle:'Original agreement',previousTitle:null,kind:'initial'}),/No confirmed budget hours/);
    const renewal=historicalHoursNote({hours:12,startsOn:'2026-09-20',endsOn:null,agreementTitle:'Renewed agreement',previousTitle:'Original retainer',kind:'renewal'});
    assert.match(renewal,/count against Renewed agreement/);
    assert.match(renewal,/count against Original retainer/);
    assert.equal(agreementHistoryHeading(null,false).opensHistory,true);
    assert.equal(agreementHistoryHeading(null,false).label,'Agreement history');
    assert.equal(agreementHistoryHeading(original,false).opensHistory,false);
    assert.match(NO_AGREEMENT_RECORDED,/^No agreement recorded yet/);
});
test('agreed scope stays off the date inputs', () => {
    const scope = 'Phase test agreement (test client). 10 SEO hours/month.';
    assert.equal(dateInputValue(scope), '');
    assert.equal(dateInputValue('2026-08-01'), '2026-08-01');
    const terms = { mode: 'monthly' as const, hours: 10, hoursMode: 'committed' as const, proration: 'daily' as const, timezone: 'America/Los_Angeles', services: [] };
    const initial = agreementFormInput({ kind: 'initial', previous: null, today: '2026-10-14', launchDate: null, onboardingDate: '2026-08-01', deliverables: scope, ...terms });
    assert.equal(initial.startsOn, '2026-08-01');
    assert.equal(initial.endsOn, null);
    assert.equal(initial.scope, scope);
    const previous = { ...original, scope, startsOn: '2026-08-01', endsOn: null, hours: 10, title: 'Original agreement' };
    const amendment = agreementFormInput({ kind: 'amendment', previous, today: '2026-10-14', deliverables: '', ...terms });
    assert.equal(amendment.startsOn, '2026-10-14');
    assert.equal(amendment.endsOn, null);
    assert.equal(amendment.scope, scope);
    assert.equal(amendment.title, 'Scope amendment');
    const renewal = agreementFormInput({ kind: 'renewal', previous: { ...previous, endsOn: '2026-09-30' }, today: '2026-10-14', deliverables: '', ...terms });
    assert.equal(renewal.startsOn, '2026-10-01');
    assert.equal(renewal.endsOn, null);
    const swapped = coerceAgreementDates({ ...initial, startsOn: scope, endsOn: scope });
    assert.equal(swapped.startsOn, '');
    assert.equal(swapped.endsOn, null);
    assert.equal(swapped.scope, scope);
});
