// Library actions shared by the sidebar, context menus and editors.
(function(root){
  const t=(key,...args)=>root.OpenCabinetI18n.t(key,...args);
  function create({document,invoke,onChanged,formatDate,formatDuration,confirm=async()=>false,formatSummary=stats=>t('time.sessions',formatDuration(stats.play_time_seconds),stats.session_count)}){
    const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
    const button=(text,action)=>{const node=el('button',text,'secondary-btn');node.type='button';node.onclick=action;return node;};
    function modal(title){
      const dialog=el('dialog',null,'confirmation-dialog library-tool-dialog'),heading=el('h2',title),header=el('div',null,'modal-header');
      const close=button('×',()=>dialog.close());close.setAttribute('aria-label',t('msg.bc74c76062'));header.append(heading,close);dialog.append(header);
      document.body.appendChild(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});return dialog;
    }
    async function pickSource(game){return invoke('select_game_file',{platform:game.platform,launchDirectly:!!game.launch_directly,extensions:null});}
    async function replaceDisc(game,disc,isCurrent=()=>true){
      const picked=await pickSource(game);if(!picked||!isCurrent())return null;
      await invoke('replace_game_source',{gameId:game.id,discId:game.launch_directly?null:disc.id??null,path:picked.rom_path});
      const discs=await invoke('get_game_discs',{id:game.id});
      await onChanged();return discs;
    }
    async function relocate(game){
      if(game.steam_app_id||game.epic_app_id)throw Error(t('library.storeSource'));
      const dialog=modal(t('library.replaceSource')),list=el('div',null,'disc-choice-list'),error=el('p',null,'disc-error');
      dialog.append(el('p',t('library.replaceHelp'),'help-text'),list,error);dialog.showModal();
      const editions=game.regions?.length?game.regions.map(region=>({...region.game,regionLabel:region.label})): [game];
      try {
        for(const edition of editions){
          const discs=edition.discs?.length?edition.discs:[{id:null,rom_path:edition.rom_path,label:edition.title}];
          for(const disc of discs){
            const item=button('',async()=>{
              item.disabled=true;error.textContent='';
              try{
                const picked=await pickSource(edition);if(!dialog.open||!picked)return;
                await invoke('replace_game_source',{gameId:edition.id,discId:edition.launch_directly?null:disc.id??null,path:picked.rom_path});
                await onChanged();dialog.close();
              }catch(reason){if(dialog.open)error.textContent=String(reason);}finally{item.disabled=false;}
            });
            item.append(el('strong',`${edition.regionLabel||edition.title} · ${disc.label||''}`),el('span',disc.rom_path));list.appendChild(item);
          }
        }
      }catch(reason){error.textContent=String(reason);}
    }
    function mountHistory(container,game,{combine=true,regionId=game.id,isCurrent=()=>true,footerRefresh=false}={}){
      let disposed=false,busy=false,offset=0,running=!!game.is_running,hasStatistics=false;
      const current=()=>!disposed&&isCurrent();
      const target={gameId:combine?game.id:regionId,combineRegions:combine};
      const list=el('div',null,'session-history-list'),status=el('p',t('sessions.loading'),'help-text'),summary=el('div',null,'session-history-summary');
      const total=el('strong');summary.append(el('span',t('sessions.total')),total);summary.setAttribute('aria-live','polite');
      const more=button(t('sessions.more'),()=>load(false));
      const refresh=button(t('sessions.refresh'),()=>load(true));
      const reset=button(t('sessions.reset'),()=>mutate(null));reset.className='secondary-btn session-history-reset';
      const actions=el('div',null,footerRefresh?'session-history-actions session-history-actions-bottom':'session-history-actions');actions.append(reset,refresh);
      const scope=game.regions?.length?el('p',combine?t('sessions.combinedScope'):t('sessions.regionScope',game.regions.find(region=>region.game.id===regionId)?.label||game.title),'help-text'):null;
      const deletes=[];
      function controls(){more.disabled=refresh.disabled=busy;reset.disabled=busy||running||!hasStatistics;deletes.forEach(node=>node.disabled=busy||running);}
      more.hidden=true;container.replaceChildren(summary,...(scope?[scope]:[]),...(footerRefresh?[list,status,more,actions]:[actions,list,status,more]));
      controls();
      async function load(replace=false){
        if(busy||!current())return;busy=true;controls();
        try{
          const page=await invoke('get_play_sessions',{...target,offset:replace?0:offset});
          if(!current())return;
          const rows=page.sessions;
          if(replace){offset=0;list.replaceChildren();deletes.length=0;}
          running=page.is_running;hasStatistics=page.session_count>0||page.play_time_seconds>0||rows.length>0;
          total.textContent=formatSummary(page);
          rows.forEach(session=>{
            const row=el('article',null,'session-history-row');
            const remove=button('🗑',()=>mutate(session));remove.className='secondary-btn session-history-delete';
            remove.setAttribute('aria-label',t('sessions.delete'));remove.title=t('sessions.delete');deletes.push(remove);
            row.append(el('strong',formatDate(session.started_at)),el('span',formatDuration(session.duration_seconds)),
              remove,el('span',session.title+' · '+String(session.rom_path).split(/[\\/]/).pop(),'help-text session-history-details'),el('span',t(`sessions.${session.state}`)+(session.ended_at?' · '+formatDate(session.ended_at):''),'help-text session-history-details'));
            row.title=session.rom_path;list.appendChild(row);
          });
          offset+=rows.length;more.hidden=rows.length<100;status.textContent=running?t('sessions.stopFirst'):offset?'':t('sessions.empty');
        }catch(reason){if(current())status.textContent=String(reason);}finally{busy=false;controls();}
      }
      async function mutate(session){
        if(busy||running||!current())return;busy=true;controls();
        let changed=false;
        try{
          const title=t(session?'sessions.deleteTitle':'sessions.resetTitle');
          const message=session?t('sessions.deleteWarning',formatDate(session.started_at),formatDuration(session.duration_seconds))
            :t('sessions.resetWarning',game.title+(scope?' · '+scope.textContent:''));
          if(!await confirm(title,message)||!current())return;
          await invoke(session?'delete_play_session':'reset_play_sessions',{...target,...(session?{sessionId:session.id}:{})});
          changed=true;
          await onChanged();
        }catch(reason){if(current())status.textContent=String(reason);}
        finally{busy=false;controls();}
        if(changed&&current()){await load(true);refresh.focus?.({preventScroll:true});}
      }
      void load();return {dispose(){disposed=true;}};
    }
    function history(game,options={}){
      const dialog=modal(t('sessions.title',game.title)),content=el('div');dialog.appendChild(content);dialog.showModal();
      const view=mountHistory(content,game,{...options,isCurrent:()=>dialog.open,footerRefresh:true});
      dialog.addEventListener('close',()=>view.dispose(),{once:true});return dialog;
    }
    async function addFolder(platform,isCurrent=()=>true){
      const directory=await invoke('select_folder');if(!directory||!isCurrent())return null;
      const extensions=String(platform.default_extensions||'').split(',').map(value=>value.trim()).filter(Boolean);
      await invoke('save_library_folder',{platformId:platform.id,directory,extensions});
      return {platform_id:platform.id,directory,extensions};
    }
    async function chooseFolder(platform){
      const folders=await invoke('get_library_folders',{platformId:platform.id});
      if(folders.length===1)return folders[0];
      return new Promise(resolve=>{
        const dialog=modal(t('library.folderTitle',platform.name)),list=el('div',null,'disc-choice-list'),error=el('p',null,'disc-error');let chosen=null;
        if(!folders.length)list.appendChild(el('p',t('library.noFolders'),'help-text'));
        folders.forEach(folder=>list.appendChild(button(folder.directory,()=>{chosen=folder;dialog.close();})));
        const add=button(t('library.addFolder'),async()=>{
          add.disabled=true;error.textContent='';
          try{const folder=await addFolder(platform,()=>dialog.open);if(folder&&dialog.open){chosen=folder;dialog.close();}}
          catch(reason){if(dialog.open)error.textContent=String(reason);}finally{add.disabled=false;}
        });
        dialog.append(list,add,error);dialog.addEventListener('close',()=>resolve(chosen),{once:true});dialog.showModal();
      });
    }
    async function renderFolders(container,platform,onScan){
      const request=container._folderRequest=(container._folderRequest||0)+1;container.replaceChildren();
      try{
        const folders=await invoke('get_library_folders',{platformId:platform.id});if(request!==container._folderRequest)return;
        if(!folders.length)container.appendChild(el('p',t('library.noFolders'),'help-text'));
        for(const folder of folders){
          const row=el('div',null,'saved-folder-row'),path=el('span',folder.directory);
          row.append(path,button(t('library.findNew'),()=>onScan(platform,folder)),button(t('library.forgetFolder'),async()=>{
            try{await invoke('remove_library_folder',{id:folder.id});if(request===container._folderRequest)await renderFolders(container,platform,onScan);}catch(reason){row.appendChild(el('p',String(reason),'disc-error'));}
          }));container.appendChild(row);
        }
        const add=button(t('library.addFolder'),async()=>{
          add.disabled=true;
          try{const folder=await addFolder(platform,()=>request===container._folderRequest);if(folder&&request===container._folderRequest)await renderFolders(container,platform,onScan);}
          catch(reason){if(request===container._folderRequest)container.appendChild(el('p',String(reason),'disc-error'));}finally{add.disabled=false;}
        });container.appendChild(add);
      }catch(reason){if(request===container._folderRequest)container.appendChild(el('p',String(reason),'disc-error'));}
    }
    function diagnostic(message){const dialog=modal(t('launch.diagnostic'));dialog.appendChild(el('p',message,'launch-diagnostic-message'));dialog.showModal();}
    return {relocate,replaceDisc,history,mountHistory,pickSource,chooseFolder,renderFolders,diagnostic};
  }
  root.OpenCabinetLibraryTools={create};
})(globalThis);
