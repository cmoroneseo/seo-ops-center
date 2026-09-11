export type GscGrain = 'property' | 'page' | 'query_page';
export interface GscFact { grain: GscGrain; page: string; query: string; clicks: number; impressions: number; position: number }
export interface GscDay { date: string; property: string; fetchedAt: string; pageLimited: boolean; queryLimited: boolean; facts: GscFact[] }

export function dateOffset(date: string, offset: number): string {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
}
export function historyWindow(now = new Date()) {
    const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    const end = dateOffset(today, -3);
    return { start: dateOffset(end, -27), end };
}
export function historyDates(start: string, end: string): string[] {
    const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value;
    if (!valid(start) || !valid(end) || start > end) throw new Error('Invalid history date range');
    const count = Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
    if (count > 31) throw new Error('Request at most 31 days at a time');
    return Array.from({length:count},(_,index)=>dateOffset(start,index));
}

export function planHistoryDays(dates: string[], existing: { data_date: string; imported_at: string }[], limit = 2): string[] {
    const known = new Map(existing.map(day=>[day.data_date,day.imported_at]));
    const missing = dates.filter(date=>!known.has(date)).reverse();
    // Refresh the newest three finalized days after backfill, oldest import first.
    const refresh = dates.slice(-3).filter(date=>known.has(date)).sort((a,b)=>known.get(a)!.localeCompare(known.get(b)!));
    return [...missing,...refresh].slice(0,limit);
}

export async function fetchGscDay(property: string, token: string, date: string, options: { fetch?: typeof fetch; rowLimit?: number; maxPages?: number; signal?: AbortSignal; now?: Date } = {}): Promise<GscDay> {
    historyDates(date,date);
    const request = options.fetch ?? fetch;
    const rowLimit = options.rowLimit ?? 1000;
    const maxPages = options.maxPages ?? 5;
    if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 25000 || !Number.isInteger(maxPages) || maxPages < 1 || rowLimit * maxPages > 50000) throw new Error('Invalid pagination limits');
    const result: GscDay = {property,date,fetchedAt:(options.now??new Date()).toISOString(),pageLimited:false,queryLimited:false,facts:[]};
    for (const grain of ['property','page','query_page'] as const) {
        const dimensions = grain === 'property' ? [] : grain === 'page' ? ['page'] : ['query','page'];
        const seen = new Set<string>();
        for (let page=0;page<(grain==='property'?1:maxPages);page++) {
            const response = await request(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
                method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
                body:JSON.stringify({startDate:date,endDate:date,type:'web',dataState:'final',aggregationType:grain==='property'?'byProperty':'byPage',dimensions,rowLimit,startRow:page*rowLimit}),
                signal:options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
            });
            if (!response.ok) throw new Error(`GSC history request failed (HTTP ${response.status})`);
            const payload = await response.json();
            const rows: unknown = payload.rows ?? [];
            if (!Array.isArray(rows) || rows.length > rowLimit || (grain==='property' && rows.length>1)) throw new Error('Invalid GSC history response');
            for (const row of rows) {
                if (!row || typeof row !== 'object' || !['clicks','impressions','position'].every(key=>typeof row[key]==='number' && Number.isFinite(row[key]) && row[key]>=0) || !Number.isInteger(row.clicks) || !Number.isInteger(row.impressions)) throw new Error('Invalid GSC history metrics');
                const keys = row.keys ?? [];
                if (!Array.isArray(keys) || keys.length!==dimensions.length || !keys.every(key=>typeof key==='string'&&key.length>0)) throw new Error('Invalid GSC history dimensions');
                const fact: GscFact = {grain,query:grain==='query_page'?keys[0]:'',page:grain==='page'?keys[0]:grain==='query_page'?keys[1]:'',clicks:row.clicks,impressions:row.impressions,position:row.position};
                const key=JSON.stringify([fact.query,fact.page]);
                // Tied rows can shift between pages; fail rather than double-count a day.
                if(seen.has(key)) throw new Error('GSC pagination repeated a row; retry this day');
                seen.add(key); result.facts.push(fact);
            }
            if(rows.length<rowLimit || grain==='property') break;
            if(page===maxPages-1) { if(grain==='page') result.pageLimited=true; else result.queryLimited=true; }
        }
    }
    return result;
}

export function rowToHistoryDay(row: {id:string;data_date:string;imported_at:string;page_limited:boolean;query_limited:boolean}) {
    return {id:row.id,date:row.data_date,importedAt:row.imported_at,pageLimited:row.page_limited,queryLimited:row.query_limited};
}
export function rowToHistoryFact(row: {id:number;day_id:string;page:string;query:string;clicks:number;impressions:number;position:number}) {
    return {id:row.id,dayId:row.day_id,page:row.page,query:row.query,clicks:row.clicks,impressions:row.impressions,position:row.position,ctr:row.impressions>0?row.clicks/row.impressions:0};
}
