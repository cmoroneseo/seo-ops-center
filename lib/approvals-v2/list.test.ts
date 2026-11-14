import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalGroup, linkState, parseListQuery, typeLabel } from './list';
const now=Date.parse('2026-11-14T00:00:00Z');
test('request groups use draft first, then any changes, then all approved',()=>{
 assert.equal(approvalGroup('draft',[{status:'approved'}]),'ready_to_send');
 assert.equal(approvalGroup('sent',[]),'waiting');
 assert.equal(approvalGroup('sent',[{status:'approved'},{status:'changes_requested'}]),'changes_requested');
 assert.equal(approvalGroup('sent',[{status:'approved'}]),'approved');
 assert.equal(approvalGroup('sent',[{status:'pending'}]),'waiting');
});
test('link states include exact three-day boundary, expiration and revocation precedence',()=>{
 assert.equal(linkState(null,now),'none');
 for(const [days,state] of [[0,'expired'],[-1,'expired'],[3,'expiring'],[4,'active']] as const)assert.equal(linkState({expires_at:new Date(now+days*86400000).toISOString(),revoked_at:null},now),state);
 assert.equal(linkState({expires_at:'2020-01-01',revoked_at:'2020-01-01'},now),'revoked');
});
test('list query validates enums, UUIDs and cursor structure',()=>{
 assert.equal(parseListQuery(new URLSearchParams()).archived,'false');
 assert.equal(parseListQuery(new URLSearchParams('owner=me&type=city&archived=true')).type,'city');
 for(const query of ['client=no','owner=no','status=draft','type=offer','archived=1','sort=bad','cursor=bad'])assert.throws(()=>parseListQuery(new URLSearchParams(query)));
 const cursor=Buffer.from(JSON.stringify({key:'2026-01-01',id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})).toString('base64url');
 assert.equal(parseListQuery(new URLSearchParams({cursor})).cursor,cursor);
});
test('mixed page kinds use Pages; single kinds and GBP have exact copy',()=>{
 assert.equal(typeLabel({itemType:'page',pageKinds:['blog','city']}),'Pages');
 assert.equal(typeLabel({itemType:'page',pageKinds:['service']}),'Service page');
 assert.equal(typeLabel({itemType:'gbp_post',pageKinds:[]}),'GBP posts');
});
