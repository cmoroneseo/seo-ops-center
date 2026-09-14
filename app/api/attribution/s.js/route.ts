import { NextResponse } from 'next/server';

const SCRIPT = `(function(){
  var ENDPOINT='/api/attribution/collect';
  var el=document.currentScript;
  if(!el)return;
  var siteId=el.getAttribute('data-site');
  if(!siteId)return;
  var trackTel=el.getAttribute('data-track-tel')!=='false';
  var origin=el.src.replace(/\\/api\\/attribution\\/s\\.js.*/,'');

  var S;
  var SK='_attr_v2_'+siteId;
  var sess;
  try{S=sessionStorage;sess=JSON.parse(S.getItem(SK));}catch(e){}

  function utmParam(n){try{return new URLSearchParams(location.search).get(n)||'';}catch(e){return '';}}
  function devType(){return /Mobi|Android/i.test(navigator.userAgent)?'mobile':/Tablet|iPad/i.test(navigator.userAgent)?'tablet':'desktop';}
  function uuid(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return(c==='x'?r:(r&0x3|0x8)).toString(16);});}

  if(!sess||typeof sess.sid!=='string'||typeof sess.ref!=='string'){
    sess={sid:uuid(),ref:document.referrer,lp:location.origin+location.pathname,
      us:utmParam('utm_source'),um:utmParam('utm_medium'),uc:utmParam('utm_campaign')};
    try{S.setItem(SK,JSON.stringify(sess));}catch(e){}
  }

  var queue=[];
  var disabled=false;
  function push(type,extra){
    if(disabled)return;
    queue.push(Object.assign({
      client_event_id:uuid(),
      event_type:type,
      page_url:location.origin+location.pathname,
      referrer:document.referrer,
      session_id:sess.sid,
      landing_page:sess.lp,
      initial_referrer:sess.ref,
      initial_utm_source:sess.us,
      initial_utm_medium:sess.um,
      initial_utm_campaign:sess.uc,
      utm_source:sess.us,
      utm_medium:sess.um,
      utm_campaign:sess.uc,
      device_type:devType(),
      timestamp:new Date().toISOString()
    },extra||{}));
  }

  function flush(){
    if(disabled||!queue.length)return;
    var batch=queue.splice(0);
    var body=JSON.stringify({site_id:siteId,events:batch});
    try{fetch(origin+ENDPOINT,{method:'POST',mode:'cors',credentials:'omit',keepalive:true,
      headers:{'Content-Type':'text/plain;charset=UTF-8'},body:body}).then(function(res){
        if(res.status===400||res.status===403||res.status===404){disabled=true;queue=[];return;}
        if(!res.ok)throw new Error('collector rejected batch');
      }).catch(function(){queue=batch.concat(queue);});}catch(e){queue=batch.concat(queue);}
  }

  push('pageview');

  function findHdyhau(form){
    var sels=form.querySelectorAll('select,input[type=radio]:checked');
    var allowed=['how_did_you_hear','how_did_you_hear_about_us','how-did-you-hear','howdidyouhear','lead_source','referral_source'];
    for(var i=0;i<sels.length;i++){
      var n=(sels[i].name||sels[i].id||'').toLowerCase();
      if(allowed.indexOf(n)!==-1){
        return sels[i].value||'';
      }
    }
    return '';
  }

  document.addEventListener('submit',function(e){
    var form=e.target;
    if(!form||form.tagName!=='FORM')return;
    var val=findHdyhau(form);
    push('form_submit',{hdyhau_value:val||null});
    flush();
  },true);

  if(trackTel){
    document.addEventListener('click',function(e){
      var a=e.target;
      while(a&&a.tagName!=='A')a=a.parentElement;
      if(a&&a.href&&a.href.indexOf('tel:')===0){
        push('tel_click');
        flush();
      }
    },true);
  }

  var timer;
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush();});
  window.addEventListener('pagehide',flush);
  timer=setInterval(function(){if(queue.length)flush();},5000);
})();`;

export async function GET() {
    return new NextResponse(SCRIPT, {
        status: 200,
        headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
