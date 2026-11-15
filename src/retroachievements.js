// Display-only RetroAchievements integration. No password or API key is kept in frontend storage.
(() => {
  const t=(key,...args)=>globalThis.OpenCabinetI18n.t(key,...args);
  function create({document,invoke,getEdition=game=>game,onPreferences=()=>{},onError=console.error}) {
    const host=document.getElementById('ra-sidebar');
    let selected=null,state=null,generation=0,timer=null,panelGeneration=0,searchGeneration=0;
    const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
    function button(key,action,glyph){const el=node('button','secondary-btn');el.type='button';el.title=t(key);el.setAttribute('aria-label',t(key));
      if(glyph)globalThis.OpenCabinetIcons.set(el,glyph);else el.textContent=t(key);el.onclick=action;return el;}
    const openUrl=url=>void invoke('open_source_url',{url}).catch(onError);
    function render(message='',loading=false){
      host.replaceChildren();host.classList.toggle('hidden',!selected);if(!selected)return;
      const header=node('div','ra-header'),title=node('h3',null,t('ra.title')),actions=node('div','ra-actions');header.append(title,actions);host.append(header);
      if(!state?.account.connected){host.append(node('p','preference-help',message||t('ra.connectHelp')),button('ra.connect',onPreferences));return;}
      if(!state.supported){host.append(node('p','preference-help',t('ra.unsupported')));return;}
      const refresh=button('ra.refresh',()=>select(selected,{refresh:true}),'rotate-ccw');refresh.disabled=loading;
      const change=button('ra.link',()=>void choose(),'link');actions.append(change,refresh);
      const progress=state.progress;
      if(progress){
        const completed=progress.achievements.filter(a=>a.earned).length,hardcore=progress.achievements.filter(a=>a.hardcore).length,total=progress.achievements.length;
        const summary=node('p','ra-summary',t('ra.summary',completed,total));host.append(summary);
        const meter=node('progress','ra-progress');meter.max=Math.max(total,1);meter.value=completed;meter.setAttribute('aria-label',summary.textContent);host.append(meter);
        const detail=node('p','preference-help',t('ra.hardcore',hardcore));host.append(detail);
        const link=button('ra.openGame',()=>openUrl('https://retroachievements.org/game/'+progress.id));link.textContent=progress.title;link.classList.add('ra-game-link');host.append(link);
        const details=node('details','ra-achievements'),label=node('summary',null,t('ra.showAll'));details.append(label);
        const list=node('div','ra-achievement-list');
        for(const a of progress.achievements){
          const row=node('button','ra-achievement'+(a.earned?' earned':''));row.type='button';row.title=a.description;row.onclick=()=>openUrl('https://retroachievements.org/achievement/'+a.id);
          if(a.badge){const img=node('img');img.src=a.badge;img.alt='';img.loading='lazy';img.decoding='async';row.append(img);}
          const content=node('span');content.append(node('strong',null,a.title),node('span','ra-achievement-description',a.description),node('span','preference-help',t(a.hardcore?'ra.earnedHardcore':a.earned?'ra.earned':'ra.locked',a.points)));row.append(content);list.append(row);
        }
        details.append(list);host.append(details);
      }else host.append(node('p','preference-help',t(loading?'ra.loading':'ra.noMatch')));
      if(message||state.warning||state.stale){const note=node('p','preference-help',message||state.warning||t('ra.cached'));note.setAttribute('role','status');host.append(note);}
    }
    async function select(game,{refresh=false}={}) {
      if(!refresh&&selected&&game&&getEdition(selected).id===getEdition(game).id)return;
      selected=game;state=null;clearTimeout(timer);const current=++generation;++searchGeneration;
      if(!game){render();return;}
      host.replaceChildren();host.classList.add('hidden');
      const id=getEdition(game).id;
      try{
        const cached=await invoke('get_ra_game',{id,refresh:false,cachedOnly:true});if(current!==generation)return;
        state=cached;render('',state.account.connected&&state.supported&&!state.progress);
        if(!state.account.connected||!state.supported||(!refresh&&state.progress&&!state.stale))return;
        timer=setTimeout(async()=>{
          if(current!==generation)return;
          render('',true);
          try {const result=await invoke('get_ra_game',{id,refresh,cachedOnly:false});if(current!==generation)return;state=result;render();}
          catch(error){if(current===generation)render(String(error));}
        },250);
      }catch(error){if(current===generation){host.classList.remove('hidden');render(String(error));}}
    }
    async function choose(){
      if(!selected||!state||host.querySelector('.ra-link-editor'))return;
      const current=generation,id=getEdition(selected).id;const chooser=node('div','ra-link-editor'),query=node('input');query.type='text';query.value=getEdition(selected).title||selected.title;query.setAttribute('aria-label',t('ra.searchTitle'));
      const results=node('select');results.setAttribute('aria-label',t('ra.matches'));const note=node('p','preference-help');note.setAttribute('role','status');
      const search=button('ra.search',async()=>{
        const version=++searchGeneration;search.disabled=true;results.replaceChildren();note.textContent=t('ra.loading');
        try{const matches=await invoke('search_ra_games',{id,query:query.value});if(current!==generation||version!==searchGeneration)return;
          const empty=node('option',null,t('ra.choose'));empty.value='';results.append(empty);
          for(const match of matches){const option=node('option',null,`${match.title} · #${match.id} · ${match.count}`);option.value=match.id;results.append(option);}note.textContent=matches.length?'':t('ra.noMatch');
        }catch(error){if(current===generation&&version===searchGeneration)note.textContent=String(error);}finally{search.disabled=false;}
      },'search');
      query.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();search.click();}};
      async function save(remoteId){if(current!==generation)return;for(const b of chooser.querySelectorAll('button'))b.disabled=true;
        try{await invoke('set_ra_game',{id,remoteId});if(current===generation)void select(selected,{refresh:true});}
        catch(error){note.textContent=String(error);for(const b of chooser.querySelectorAll('button'))b.disabled=false;}}
      const use=button('ra.use',()=>{if(results.value)void save(Number(results.value));});
      const auto=button('ra.automatic',()=>void save(null));const disable=button('ra.noAchievements',()=>void save(0));const cancel=button('ra.cancel',()=>{++searchGeneration;render();});
      const actions=node('div','ra-actions');actions.append(use,auto,disable,cancel);chooser.append(query,search,results,note,actions,node('p','preference-help',t('ra.matchHelp')));host.append(chooser);query.focus();search.click();
    }
    async function openSettings(){
      const current=++panelGeneration,settings=document.getElementById('ra-settings');settings.replaceChildren();
      const status=node('p','preference-help');status.setAttribute('role','status');settings.append(status);
      try{
        const account=await invoke('get_ra_account');if(current!==panelGeneration)return;
        const form=node('div','ra-account-form'),username=node('input'),key=node('input');username.type='text';username.autocomplete='off';username.maxLength=80;username.value=account.username;
        key.type='password';key.autocomplete='new-password';key.maxLength=256;
        function field(label,input){const group=node('div','form-group'),caption=node('label',null,t(label));input.id=label.replace('.','-');caption.htmlFor=input.id;group.append(caption,input);return group;}
        const buttons=node('div','ra-actions');
        const connect=button('ra.connect',()=>void task(async()=>{
          const apiKey=key.value;key.value='';const result=await invoke('connect_ra_account',{username:username.value,apiKey});status.textContent=t('ra.connected',result.username);
          username.value=result.username;disconnect.disabled=false;void select(selected,{refresh:true});
        }));
        const disconnect=button('ra.disconnect',()=>void task(async()=>{await invoke('disconnect_ra_account');status.textContent=t('ra.disconnected');key.value='';void select(selected,{refresh:true});}));
        for(const input of [username,key])input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();connect.click();}};
        disconnect.disabled=!account.connected;
        async function task(fn){if(connect.disabled)return;connect.disabled=disconnect.disabled=username.disabled=key.disabled=true;status.textContent=t('ra.loading');
          try{await fn();}catch(error){status.textContent=String(error);}finally{connect.disabled=username.disabled=key.disabled=false;
            try{const latest=await invoke('get_ra_account');disconnect.disabled=!latest.connected;}catch{disconnect.disabled=false;}}}
        buttons.append(connect,disconnect,button('ra.getKey',()=>openUrl('https://retroachievements.org/settings?tab=applications'),'external-link'));
        form.append(field('ra.username',username),field('ra.apiKey',key),buttons,node('p','preference-help',t('ra.keyHelp')));
        settings.prepend(form);status.textContent=account.connected?t('ra.connected',account.username):t('ra.disconnected');
      }catch(error){status.textContent=String(error);}
    }
    function invalidate(){++generation;clearTimeout(timer);state=null;const game=selected;selected=null;void select(game);}
    return {select,openSettings,invalidate,clearSecret(){const key=document.getElementById('ra-apiKey');if(key)key.value='';},refresh(){if(selected)void select(selected,{refresh:true});},dispose(){++generation;++panelGeneration;++searchGeneration;clearTimeout(timer);}};
  }
  globalThis.OpenCabinetAchievements={create};
})();
