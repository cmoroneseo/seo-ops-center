import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { agencyLinks, clientSections } from '../nav/staff-shell';
import { approvalNotificationUrl } from '../supabase/notifications';
test('both approval notification entities navigate to the full request',()=>{
 for(const entityType of ['approval_request','gbp_approval_request'] as const)assert.equal(approvalNotificationUrl({entityType,entityId:'id-1'}),'/approvals/id-1');
 assert.equal(approvalNotificationUrl({entityType:'task',entityId:'id-1'}),null);
});
test('agency/sidebar and mobile expose Approvals; frozen client tab is absent',()=>{
 assert.equal(agencyLinks({agencyDashboard:false}).find(l=>l.id==='approvals')?.href,'/approvals');
 const mobile=readFileSync(new URL('../../components/dashboard/MobileNav.tsx',import.meta.url),'utf8');
 const sidebar=readFileSync(new URL('../../components/dashboard/Sidebar.tsx',import.meta.url),'utf8');
 assert.match(mobile,/name: 'Approvals', href: '\/approvals'/);assert.match(sidebar,/ApprovalBadge/);
 for(const pipelineNav of [false,true])assert.equal(clientSections('client',{keywordTracking:true,vault:true,campaignWorkspace:true,pipelineNav}).flatMap(s=>[...s.links,...(s.overflow??[])]).some(l=>l.id==='approvals'),false);
});
