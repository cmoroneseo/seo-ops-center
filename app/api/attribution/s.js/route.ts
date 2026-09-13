import { NextResponse } from 'next/server';

const SCRIPT = `(function(){
  var ENDPOINT='/api/attribution/collect';
  var el=document.currentScript;
  if(!el)return;
  var siteId=el.getAttribute('data-site');
  if(!siteId)return;
  var origin=el.src.replace(/\\/api\\/attribution\\/s\\.js.*/,'');

  var S=sessionStorage;
  var SK='_attr';
  var sess;
  try{sess=JSON.parse(S.getItem(SK));}catch(e){}

  function utmParam(n){try{return new URLSearchParams(location.search).get(n)||'';}catch(e){return '';}}
  function devType(){return /Mobi|Android/i.test(navigator.userAgent)?'mobile':/Tablet|iPad/i.test(navigator.userAgent)?'tablet':'desktop';}
  function uuid(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return(c==='x'?r:(r&0x3|0x8)).toString(16);});}

  if(!sess){
    sess={sid:uuid(),src:document.referrer,lp:location.pathname};
    try{S.setItem(SK,JSON.stringify(sess));}catch(e){}
  }

  var queue=[];
  function push(type,extra){
    queue.push(Object.assign({
      event_type:type,
      page_url:location.pathname,
      referrer:document.referrer,
      session_id:sess.sid,
      landing_page:sess.lp,
      session_source:sess.src,
      utm_source:utmParam('utm_source'),
      utm_medium:utmParam('utm_medium'),
      utm_campaign:utmParam('utm_campaign'),
      device_type:devType(),
      timestamp:new Date().toISOString()
    },extra||{}));
  }

  function flush(){
    if(!queue.length)return;
    var batch=queue.splice(0);
    var body=JSON.stringify({site_id:siteId,events:batch});
    if(navigator.sendBeacon){navigator.sendBeacon(origin+ENDPOINT,new Blob([body],{type:'application/json'}));}
    else{try{var x=new XMLHttpRequest();x.open('POST',origin+ENDPOINT,false);x.setRequestHeader('Content-Type','application/json');x.send(body);}catch(e){}}
  }

  push('pageview');

  function findHdyhau(form){
    var sels=form.querySelectorAll('select,input[type=radio]');
    for(var i=0;i<sels.length;i++){
      var n=(sels[i].name||sels[i].id||'').toLowerCase();
      if(/hear|found|source|referral|how_did/.test(n)){
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

  document.addEventListener('click',function(e){
    var a=e.target;
    while(a&&a.tagName!=='A')a=a.parentElement;
    if(a&&a.href&&a.href.indexOf('tel:')===0){
      push('tel_click');
      flush();
    }
  },true);

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
