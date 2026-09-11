import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGSC } from './fetchGSC';
const getToken = async () => ({ token: 'test-token', creds: {site_url:'sc-domain:example.com'} });
test('GSC query uses exact selected scope and returns monthly totals', async () => {
    const calls: string[] = [];
    const data = await fetchGSC('client','2026-08', {getToken: async (_id, service) => {assert.equal(service,'gsc'); return getToken();}, markError: async () => {throw new Error('unexpected');}, fetch: async (url, init) => {
        calls.push(String(url)); const body = JSON.parse(String(init?.body));
        assert.equal(body.startDate,'2026-08-01'); assert.equal(body.endDate,'2026-08-31');
        return Response.json({rows:[{clicks:12,impressions:100,position:4.2}]});
    }});
    assert.match(calls[0],/sc-domain%3Aexample.com/); assert.deepEqual(data,{organic_clicks:12,impressions:100,avg_position:4.2,ctr:0.12});
});
test('missing GSC authorization never falls back to GA4', async () => {
    const services: string[]=[];
    assert.equal(await fetchGSC('client','2026-08',{getToken:async (_id,service)=>{services.push(service);return null;},fetch:async()=>{throw new Error('must not fetch');},markError:async()=>{}}),null);
    assert.deepEqual(services,['gsc']);
});
test('Google errors are marked and thrown so sync cannot report success', async () => {
    const errors:string[]=[];
    await assert.rejects(fetchGSC('client','2026-08',{getToken,fetch:async()=>new Response('private upstream detail',{status:403}),markError:async (_id,_service,message)=>{errors.push(message);}}),/HTTP 403/);
    assert.equal(errors.length,1); assert.doesNotMatch(errors[0],/private upstream/);
});
