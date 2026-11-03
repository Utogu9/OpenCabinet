// Personal data, library insights and resumable-import controls.
(function(root){
  const statuses=['unplayed','planned','playing','completed','abandoned'];
  const t=(key,...args)=>root.OpenCabinetI18n.t(key,...args);
  const personal=game=>({status:'unplayed',favorite:false,rating:0,notes:'',...game?.personal,status:game?.personal?.status||'unplayed'});
  function create({document,invoke,getGames,onPersonal,onEdit,onRelocate,onResume,formatDuration,confirm,onError=()=>{}}){
    const savingGames=new Set();let displayedGameId=null;
    const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
    const button=(label,action,cls='secondary-btn')=>{const node=el('button',label,cls);node.type='button';node.onclick=action;return node;};
    function dialog(title){
      const node=el('dialog',undefined,'confirmation-dialog library-tool-dialog feature-dialog'),header=el('div',undefined,'modal-header'),body=el('div',undefined,'modal-body');
      const close=button('',()=>node.close(),'close-btn');root.OpenCabinetIcons.set(close,'x');close.setAttribute('aria-label',t('backup.close'));
      header.append(el('h2',title),close);node.append(header,body);document.body.appendChild(node);
      node.addEventListener('close',()=>node.remove(),{once:true});return {node,body};
    }
    function fields(host,value){
      const status=el('select');status.setAttribute('aria-label',t('personal.status'));
      for(const name of statuses){const option=el('option',t('personal.'+name));option.value=name;status.appendChild(option);}status.value=value.status||'unplayed';
      const favorite=button('',()=>{favorite.checked=!favorite.checked;favorite.setAttribute('aria-pressed',String(favorite.checked));},'media-preference-button');
      favorite.checked=!!value.favorite;favorite.setAttribute('aria-pressed',String(favorite.checked));favorite.setAttribute('aria-label',t('personal.favorite'));root.OpenCabinetIcons.set(favorite,'star');
      const rating=el('select');rating.setAttribute('aria-label',t('personal.rating'));
      for(let i=0;i<=5;i++){const option=el('option',i?'★'.repeat(i):t('personal.unrated'));option.value=String(i);rating.appendChild(option);}rating.value=String(value.rating||0);
      const notes=el('textarea');notes.rows=8;notes.maxLength=100000;notes.value=value.notes||'';notes.setAttribute('aria-label',t('personal.notes'));
      const group=(label,control)=>{const field=el('label',undefined,'form-group');field.append(el('span',label),control);return field;};
      const row=el('div',undefined,'form-grid');row.append(group(t('personal.status'),status),group(t('personal.rating'),rating));
      const check=el('div',undefined,'preference-toggle');check.append(favorite,el('span',t('personal.favorite')));
      host.append(row,check,group(t('personal.notes'),notes));
      return {status,notes,value:()=>({status:status.value,favorite:favorite.checked,rating:Number(rating.value),notes:notes.value})};
    }
    async function editPersonal(game,focus='status'){
      const {node,body}=dialog(game.title);const form=el('form'),error=el('p','', 'feature-error');
      const controls=fields(form,personal(game));const actions=el('div',undefined,'form-actions');
      const cancel=button(t('msg.bb9dbb406d'),()=>node.close()),save=button(t('personal.save'),()=>{} ,'primary-btn');save.type='submit';actions.append(cancel,save);form.append(error,actions);body.append(form);
      form.onsubmit=async event=>{event.preventDefault();save.disabled=true;error.textContent='';try{
        const updated=await invoke('set_game_personal',{gameId:game.id,personal:controls.value()});onPersonal(game.id,updated);node.close();
      }catch(reason){if(node.open)error.textContent=String(reason);}finally{save.disabled=false;}};
      node.showModal();controls[focus]?.focus();
    }
    function showGame(game){
      const select=document.getElementById('details-game-status'),notes=document.getElementById('details-personal-notes'),favorite=document.getElementById('details-favorite');
      if(!select)return;displayedGameId=game.id;const value=personal(game);select.replaceChildren();
      for(const name of statuses){const option=el('option',t('personal.'+name));option.value=name;select.appendChild(option);}select.value=value.status;
      notes.textContent=value.notes||t('personal.noNotes');favorite.setAttribute('aria-pressed',String(value.favorite));favorite.classList.toggle('is-favorite',value.favorite);
      const ratingHost=document.getElementById('details-personal-rating');
      if(ratingHost&&ratingHost.children.length!==5){ratingHost.replaceChildren();for(let i=1;i<=5;i++){const star=button('',()=>{},'personal-rating-star');root.OpenCabinetIcons.set(star,'star');star.setAttribute('role','radio');ratingHost.appendChild(star);}}
      const stars=Array.from(ratingHost?.children||[]);
      const controls=()=>{select.disabled=favorite.disabled=savingGames.has(game.id);stars.forEach(star=>star.disabled=savingGames.has(game.id));};
      const set=async patch=>{if(savingGames.has(game.id))return;savingGames.add(game.id);controls();try{const updated=await invoke('set_game_personal',{gameId:game.id,personal:{...personal(getGames().find(item=>item.id===game.id)||game),...patch}});onPersonal(game.id,updated);}catch(reason){onError(String(reason));}finally{savingGames.delete(game.id);if(displayedGameId===game.id)showGame(getGames().find(item=>item.id===game.id)||game);}};
      ratingHost?.setAttribute('aria-label',t('personal.rating'));ratingHost?.setAttribute('title',t('personal.currentRating',value.rating));
      stars.forEach((star,index)=>{
        const score=index+1;star.setAttribute('data-filled',String(score<=value.rating));star.setAttribute('aria-checked',String(score===value.rating));star.tabIndex=score===(value.rating||1)?0:-1;
        star.title=t(score===value.rating?'personal.clearRating':'personal.setRating',score);star.setAttribute('aria-label',star.title);
        star.onclick=()=>set({rating:score===value.rating?0:score});
        star.onkeydown=event=>{let score;if(event.key==='ArrowRight'||event.key==='ArrowUp')score=Math.min(5,index+2);else if(event.key==='ArrowLeft'||event.key==='ArrowDown')score=Math.max(1,index);else if(event.key==='Home')score=1;else if(event.key==='End')score=5;else if(event.key==='Delete'||event.key==='Backspace')score=0;else return;event.preventDefault();stars[Math.max(0,score-1)].focus();return set({rating:score});};
      });controls();
      select.onchange=()=>set({status:select.value});favorite.onclick=()=>set({favorite:!personal(getGames().find(item=>item.id===game.id)||game).favorite});
      document.getElementById('btn-personal-notes').onclick=()=>editPersonal(getGames().find(item=>item.id===game.id)||game,'notes');
    }
    async function dashboard(){
      const {node,body}=dialog(t('insights.title'));const error=el('p',t('insights.loading'),'help-text'),controls=el('div',undefined,'feature-toolbar'),select=el('select'),refresh=button(t('sessions.refresh'),load);
      for(const key of ['platforms','months','regions','top_games']){const option=el('option',t('insights.'+key));option.value=key;select.appendChild(option);}
      const summary=el('div',undefined,'feature-summary'),chart=el('div',undefined,'feature-chart'),states=el('div',undefined,'feature-statuses');let data=null;
      select.setAttribute('aria-label',t('insights.groupBy'));select.onchange=render;controls.append(select,refresh);body.append(summary,controls,error,chart,states);node.showModal();await load();
      async function load(){refresh.disabled=true;try{const report=await invoke('get_library_dashboard');if(!node.open)return;data=report;render();}catch(reason){if(node.open)error.textContent=String(reason);}finally{refresh.disabled=false;}}
      function render(){if(!data)return;summary.replaceChildren();for(const [label,value]of [['insights.games',data.total_games],['insights.time',formatDuration(data.seconds)],['insights.sessions',data.sessions]]){const tile=el('div');tile.append(el('span',t(label)),el('strong',String(value)));summary.appendChild(tile);}
        error.textContent=data.recorded_seconds!==data.seconds?t('insights.legacy'):'';
        const list=data[select.value]||[],maximum=Math.max(1,...list.map(item=>item.seconds));chart.replaceChildren();
        if(!list.length)chart.append(el('p',t('insights.empty'),'help-text'));
        for(const item of list){const row=el('div',undefined,'feature-chart-row'),bar=el('div',undefined,'feature-chart-bar'),fill=el('span');fill.style.width=`${item.seconds/maximum*100}%`;bar.appendChild(fill);row.append(el('span',item.name||t('insights.unknown')),bar,el('strong',formatDuration(item.seconds)));row.title=t('insights.bucket',item.games,item.sessions);chart.appendChild(row);}
        states.replaceChildren();for(const status of statuses)states.append(el('span',`${t('personal.'+status)}: ${data.statuses[status]||0}`));
      }
    }
    async function report(){
      const {node,body}=dialog(t('report.title')),toolbar=el('div',undefined,'feature-toolbar'),query=el('input'),filter=el('select'),platform=el('select'),list=el('div',undefined,'feature-report-list'),message=el('p',t('insights.loading'),'help-text');let rows=[];
      query.type='search';query.placeholder=t('report.search');query.setAttribute('aria-label',t('report.search'));
      for(const issue of ['all','file','cover','logo','back_cover','manual','catalog','emulator']){const option=el('option',t('report.'+issue));option.value=issue;filter.appendChild(option);}filter.setAttribute('aria-label',t('report.filter'));platform.setAttribute('aria-label',t('msg.e0236ea3bc'));
      const refresh=button(t('sessions.refresh'),load);toolbar.append(query,filter,platform,refresh);body.append(toolbar,message,list);query.oninput=filter.onchange=platform.onchange=render;node.showModal();await load();
      async function load(){refresh.disabled=true;message.textContent=t('insights.loading');try{rows=await invoke('get_library_report');if(!node.open)return;const chosen=platform.value;platform.replaceChildren();const all=el('option',t('report.allPlatforms'));all.value='';platform.appendChild(all);for(const name of [...new Set(rows.map(row=>row.platform))].sort()){const option=el('option',name);option.value=name;platform.appendChild(option);}platform.value=chosen;render();}catch(reason){if(node.open)message.textContent=String(reason);}finally{refresh.disabled=false;}}
      function render(){const selected=rows.filter(row=>(!platform.value||row.platform===platform.value)&&(filter.value==='all'||row.issues.includes(filter.value))&&row.title.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()));message.textContent=t('report.count',selected.length);list.replaceChildren();
        // Incremental display keeps a very large library report responsive.
        let shown=0;function more(){const end=Math.min(shown+100,selected.length);for(;shown<end;shown++){const row=selected[shown],item=el('article',undefined,'feature-report-row'),actions=el('div',undefined,'feature-toolbar');item.append(el('strong',row.title),el('span',row.platform,'help-text'),el('p',row.issues.map(key=>t('report.'+key)).join(' · ')));
          const edit=button(t('msg.ab5c261bc2'),()=>{node.close();onEdit(row.id);});actions.append(edit);if(row.missing_paths.length)actions.append(button(t('library.replaceSource'),()=>onRelocate(row.id).then(load)));item.append(actions);list.appendChild(item);}
          next.hidden=shown>=selected.length;}
        const next=button(t('sessions.more'),()=>{next.remove();more();list.appendChild(next);});more();list.appendChild(next);
      }
    }
    async function pending(){
      const {node,body}=dialog(t('resume.title')),status=el('p',t('insights.loading'),'help-text'),list=el('div',undefined,'feature-report-list');body.append(status,list);node.showModal();
      async function load(){try{const rows=await invoke('get_pending_imports');if(!node.open)return;status.textContent=rows.length?t('resume.help'):t('resume.empty');list.replaceChildren();for(const row of rows){const item=el('article',undefined,'feature-report-row'),actions=el('div',undefined,'feature-toolbar');item.append(el('strong',row.platform),el('p',t('resume.summary',row.games,row.completed,row.total)));actions.append(button(t('resume.continue'),()=>{node.close();onResume(row);},'primary-btn'),button(t('resume.discard'),async()=>{if(await confirm(t('resume.discardConfirm'))){try{await invoke('discard_pending_import',{id:row.id});await load();}catch(reason){status.textContent=String(reason);}}}));item.append(actions);list.appendChild(item);}}catch(reason){if(node.open)status.textContent=String(reason);}}
      await load();
    }
    async function resume(row){
      const {node,body}=dialog(t('resume.title')),status=el('p',t('insights.loading')),bar=el('progress'),failures=el('div'),actions=el('div',undefined,'form-actions');bar.max=100;body.append(status,bar,failures,actions);node.showModal();let session=null,busy=false,closing=false,committed=false;
      const retry=button(t('msg.918d57e47c'),download),finish=button(t('resume.import'),commit,'primary-btn'),pause=button(t('resume.pause'),()=>node.close());actions.append(pause,retry,finish);retry.disabled=finish.disabled=true;
      const progress=()=>{const channel=new root.__TAURI__.core.Channel();channel.onmessage=update=>{if(!node.open)return;status.textContent=t('resume.progress',update.processed,update.total||'?')+(update.current_file?' · '+update.current_file:'');if(update.total)bar.value=update.processed/update.total*100;else bar.removeAttribute('value');};return channel;};
      node.addEventListener('close',()=>{closing=true;if(session&&!committed)void invoke('pause_metadata_import',{jobId:session.job_id}).catch(()=>{});});
      try{session=await invoke('restore_metadata_import',{id:row.id});if(closing){await invoke('pause_metadata_import',{jobId:session.job_id});return;}await download();}catch(reason){if(node.open)status.textContent=String(reason);}
      async function download(){if(!session||busy)return;busy=true;retry.disabled=finish.disabled=true;try{const report=await invoke('retry_metadata_images',{jobId:session.job_id,onProgress:progress()});if(!node.open)return;failures.replaceChildren();for(const error of report.failures)failures.append(el('p',`${error.title}: ${error.message}`,'feature-error'));status.textContent=t('resume.ready',report.image_count,report.manual_count||0);retry.disabled=!report.failures.length;finish.disabled=false;}catch(reason){if(node.open){status.textContent=String(reason);retry.disabled=false;}}finally{busy=false;}}
      async function commit(){if(!session||busy)return;busy=true;retry.disabled=finish.disabled=pause.disabled=true;try{await invoke('import_scanned_roms',{preview:session.preview,platform:session.platform,jobId:session.job_id,mediaSelections:[],onProgress:progress()});committed=true;await invoke('end_metadata_import',{jobId:session.job_id});node.close();await onResume(null,true);}catch(reason){if(node.open){status.textContent=String(reason);retry.disabled=finish.disabled=pause.disabled=false;}}finally{busy=false;}}
    }
    return {editPersonal,showGame,dashboard,report,pending,resume,fields};
  }
  root.OpenCabinetFeatures={create,personal,statuses};
})(typeof window!=='undefined'?window:globalThis);
