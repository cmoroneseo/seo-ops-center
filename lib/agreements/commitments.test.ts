import test from 'node:test';
import assert from 'node:assert/strict';
import {commitmentExpectedQuantity,commitmentWindow,customOutputQuantity} from './commitments';
import type {ClientAgreement} from './types';
import type {DeliverableCommitment} from '../types';
const old:ClientAgreement={id:'old',organizationId:'org',clientId:'client',previousId:null,kind:'initial',title:'Monthly',startsOn:'2026-03-19',endsOn:'2026-09-19',mode:'monthly',hours:30,hoursMode:'committed',proration:'daily',timezone:'America/Los_Angeles',scope:'SEO',services:[],evidence:null,note:null,recordedAt:'2026-10-06',recordedBy:'owner',planSnapshot:null};
const next:ClientAgreement={...old,id:'next',previousId:'old',kind:'renewal',mode:'custom',startsOn:'2026-09-20',endsOn:'2026-12-31',hoursMode:'estimate',hours:null};
const commitment:DeliverableCommitment={id:'output',agreementId:'old',organizationId:'org',clientId:'client',type:'Content',title:'Content pieces',quantityPerMonth:2,cadence:'monthly',engagementModel:'Retainer',startsOn:'2026-03-19',isActive:true,countsTowardHours:false,generateTasks:false,customFields:{},createdAt:'2026-03-19',updatedAt:'2026-03-19'};
test('original monthly outputs stop generating after renewal and remain visible historically',()=>{
    assert.equal(commitmentWindow(commitment,[old,next])?.endsOn,'2026-09-19');
    assert.equal(commitmentExpectedQuantity(commitment,'2026-08',[old,next]),2);
    assert.equal(commitmentExpectedQuantity(commitment,'2026-10',[old,next]),0);
});
test('custom outputs belong to their due month and scheduled cancellation creates no new promise',()=>{
    const custom={...commitment,agreementId:'next',startsOn:'2026-09-20',cadence:'one_time' as const,totalQuantity:3};
    assert.equal(commitmentExpectedQuantity(custom,'2026-10',[old,next]),0);
    assert.equal(commitmentExpectedQuantity(custom,'2026-12',[old,next]),3);
    assert.equal(commitmentExpectedQuantity(custom,'2026-12',[old,{...next,cancelledAt:'2026-09-01'}]),0);
});
test('an hours-only amendment keeps the same outputs instead of generating them twice',()=>{
    const changed={...old,id:'amendment',previousId:'old',kind:'amendment' as const,startsOn:'2026-07-15',hours:40,services:[{sourceId:'output',title:'Content pieces',type:'Content' as const,quantity:2,cadence:'monthly' as const,countsTowardHours:false}]};
    assert.equal(commitmentExpectedQuantity(commitment,'2026-08',[old,changed]),2);
    assert.equal(commitmentExpectedQuantity(commitment,'2026-07',[old,changed]),2);
});
test('custom amendments count outputs issued after scheduling against the agreed total',()=>{
    const custom={...commitment,agreementId:'next',startsOn:'2026-09-20',cadence:'one_time' as const,totalQuantity:5,customFields:{agreementOutputRoot:'old-output',agreedTotalQuantity:5}};
    assert.equal(customOutputQuantity(custom,3),2);
    assert.equal(commitmentExpectedQuantity(custom,'2026-12',[old,next],3),2);
    assert.equal(customOutputQuantity(custom,6),0);
});
