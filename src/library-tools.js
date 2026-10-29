// Library actions shared by the sidebar, context menus and editors.
(function(root){
  const t=(key,...args)=>root.OpenCabinetI18n.t(key,...args);
  function create({document,invoke,onChanged,formatDate,formatDuration}){
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
      let disposed=false;
      const current=()=>!disposed&&isCurrent();
      const list=el('div',null,'session-history-list'),status=el('p',t('sessions.loading'),'help-text');
      const more=button(t('sessions.more'),load);let offset=0,busy=false;
      const refresh=button(t('sessions.refresh'),()=>{if(busy)return;offset=0;list.replaceChildren();void load();});
      const actions=el('div',null,footerRefresh?'session-history-actions session-history-actions-bottom':'session-history-actions');actions.appendChild(refresh);
      more.hidden=true;container.replaceChildren(...(footerRefresh?[list,status,more,actions]:[actions,list,status,more]));
      async function load(){
        if(busy||!current())return;busy=true;more.disabled=refresh.disabled=true;
        try{
          const rows=await invoke('get_play_sessions',{gameId:combine?game.id:regionId,combineRegions:combine,offset});
          if(!current())return;
          rows.forEach(session=>{
            const row=el('article',null,'session-history-row');
            row.append(el('strong',formatDate(session.started_at)),el('span',formatDuration(session.duration_seconds)),
              el('span',session.title+' · '+String(session.rom_path).split(/[\\/]/).pop(),'help-text'),el('span',t(`sessions.${session.state}`)+(session.ended_at?' · '+formatDate(session.ended_at):''),'help-text'));
            row.title=session.rom_path;list.appendChild(row);
          });
          offset+=rows.length;more.hidden=rows.length<100;status.textContent=offset?'':t('sessions.empty');
        }catch(reason){if(current())status.textContent=String(reason);}finally{busy=false;more.disabled=refresh.disabled=false;}
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
