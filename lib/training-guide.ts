export type TrainingGuideSection = {
    id: string;
    title: string;
    track: 'both' | 'core' | 'local';
    group: string;
    checklistItems: number;
};

export type TrainingGuideDocument = {
    title: string;
    sections: TrainingGuideSection[];
    totalChecklistItems: number;
};

export function parseTrainingGuideDocument(_html: string): TrainingGuideDocument {
    const html = _html;
    const title = decodeHtml(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
    const sectionDetails = new Map<string, { track: TrainingGuideSection['track']; checklistItems: number }>();
    const sectionPattern = /<section\s+id="([^"]+)"\s+data-track="(both|core|local)"[^>]*>([\s\S]*?)<\/section>/gi;
    for (const match of html.matchAll(sectionPattern)) {
        sectionDetails.set(match[1], {
            track: match[2] as TrainingGuideSection['track'],
            checklistItems: (match[3].match(/class="item"/g) ?? []).length,
        });
    }

    const nav = html.match(/<nav\s+id="nav">([\s\S]*?)<\/nav>/i)?.[1] ?? '';
    const sections: TrainingGuideSection[] = [];
    let group = 'Guide';
    const navEntryPattern = /<div\s+class="grp"[^>]*>([\s\S]*?)<\/div>|<a\s+href="#([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of nav.matchAll(navEntryPattern)) {
        if (match[1]) {
            group = cleanText(match[1]);
            continue;
        }
        const id = match[2];
        const details = sectionDetails.get(id);
        if (!details) continue;
        sections.push({ id, title: cleanText(match[3]), group, ...details });
    }

    return {
        title,
        sections,
        totalChecklistItems: sections.reduce((total, section) => total + section.checklistItems, 0),
    };
}

export function buildEmbeddedTrainingGuide(html: string): string {
    const embedStyles = `<style data-seo-ops-embed>
:root{--accent:#d91b82;--accent-2:#a80f62;--accent-soft:#fbe7f3;--paper:#f8f5ee;--card:#fffdf8}
html{scroll-padding-top:66px} body{background:#f8f5ee}.side{display:none!important}.wrap{display:block;max-width:none}.main{padding:22px 28px 80px}.controls{top:0}.hero{padding-top:4px!important}
@media(max-width:700px){.main{padding:18px 18px 70px}.controls{position:relative}.sechead h2{font-size:22px}.item{padding:10px}.item .ttl{font-size:14px}.item .ds{font-size:13px}}
</style>`;
    const bridgeScript = `<script data-seo-ops-embed>
(function(){
  var items=[].slice.call(document.querySelectorAll('.item'));
  var sections=[].slice.call(document.querySelectorAll('section[data-track]'));
  var restoring=false;
  function state(){
    return items.map(function(item){return !!item.querySelector('input').checked;});
  }
  function notify(){
    var saved=state();
    var sectionProgress=sections.map(function(section){
      var boxes=[].slice.call(section.querySelectorAll('.item input'));
      var completed=boxes.filter(function(box){return box.checked;}).length;
      return {id:section.id,completed:completed,total:boxes.length};
    });
    parent.postMessage({type:'seo-playbook-progress',completed:saved.filter(Boolean).length,total:saved.length,sections:sectionProgress,checked:saved},'*');
  }
  items.forEach(function(item){item.querySelector('input').addEventListener('change',function(){if(!restoring)setTimeout(notify,0);});});
  var resetButton=document.getElementById('reset');
  if(resetButton)resetButton.addEventListener('click',function(){setTimeout(notify,0);});
  document.querySelectorAll('a[href^="http"]').forEach(function(link){link.target='_blank';link.rel='noopener noreferrer';});
  window.addEventListener('message',function(event){
    if(event.source!==parent||!event.data||typeof event.data!=='object')return;
    if(event.data.type==='seo-playbook-navigate'&&typeof event.data.id==='string'){
      var target=document.getElementById(event.data.id);
      if(target&&target.matches('section[data-track]')){
        var track=target.getAttribute('data-track');
        if(track!=='both'&&target.style.display==='none'){
          var chip=document.querySelector('.chip[data-tr="'+track+'"]');
          if(chip&&!chip.classList.contains('on'))chip.click();
        }
        setTimeout(function(){target.scrollIntoView({behavior:event.data.behavior==='auto'?'auto':'smooth',block:'start'});},0);
      }
    }
    if(event.data.type==='seo-playbook-restore'&&Array.isArray(event.data.checked)){
      restoring=true;
      items.forEach(function(item,index){
        var box=item.querySelector('input'),next=event.data.checked[index]===true;
        if(box.checked!==next){box.checked=next;box.dispatchEvent(new Event('change',{bubbles:true}));}
        item.classList.toggle('done',next);
      });
      restoring=false;
      setTimeout(notify,0);
    }
  });
  var activeFrame=0;
  function sendActive(){
    activeFrame=0;
    var y=window.scrollY+200,active=sections[0];
    sections.forEach(function(section){if(section.style.display!=='none'&&section.offsetTop<=y)active=section;});
    if(window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-8){
      var visible=sections.filter(function(section){return section.style.display!=='none';});
      active=visible[visible.length-1]||active;
    }
    if(active)parent.postMessage({type:'seo-playbook-section',id:active.id},'*');
  }
  window.addEventListener('scroll',function(){if(!activeFrame)activeFrame=requestAnimationFrame(sendActive);},{passive:true});
  window.addEventListener('hashchange',function(){setTimeout(sendActive,0);});
  setTimeout(sendActive,0);
  setTimeout(sendActive,300);
  setTimeout(sendActive,800);
  parent.postMessage({type:'seo-playbook-ready'},'*');
})();
</script>`;
    return html
        .replace('</head>', `${embedStyles}\n</head>`)
        .replace('</body>', `${bridgeScript}\n</body>`);
}

function cleanText(value: string): string {
    return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeHtml(value: string): string {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}
