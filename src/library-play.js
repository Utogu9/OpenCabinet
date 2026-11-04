// Manual playlists, a filtered picker and explicit launch-action editing.
(function(root){
  const t=(key,...args)=>root.OpenCabinetI18n.t(key,...args);
  function matches(game,filter={},lists=[]){
    if(game.is_running)return false;
    if(filter.platform&&game.platform!==filter.platform)return false;
    if(filter.playlist&&!lists.find(list=>list.id===filter.playlist)?.games.includes(game.id))return false;
    if(filter.status&&(game.personal?.status||'unplayed')!==filter.status)return false;
    if(filter.unplayed&&(Number(game.session_count)>0||Number(game.play_time_seconds)>0))return false;
    if(filter.favorite&&!game.personal?.favorite)return false;
    if(filter.genre&&!String(game.genre||'').toLocaleLowerCase().includes(filter.genre.toLocaleLowerCase()))return false;
    if(filter.players&&!(Number(game.max_players)>=Number(filter.players)))return false;
    return true;
  }
  function ordered(games,list){
    if(!list)return games;
    const byId=new Map(games.map(game=>[game.id,game]));
    return list.games.map(id=>byId.get(id)).filter(Boolean);
  }
  function choose(games,filter,lists,previous=null,random=Math.random){
    const pool=games.filter(game=>matches(game,filter,lists)),others=pool.filter(game=>game.id!==previous);
    const items=others.length?others:pool;return items.length?items[Math.min(items.length-1,Math.floor(random()*items.length))]:null;
  }
  function create({document,invoke,getGames,onChanged=()=>{},onPick=()=>{},launch,confirm,onError=()=>{}}){
    let lists=[],loading=null;
    const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
    const button=(label,fn,cls='secondary-btn')=>{const node=el('button',label,cls);node.type='button';node.onclick=fn;return node;};
    function field(host,label,input){const wrap=el('label',undefined,'play-field');wrap.append(el('span',label),input);host.append(wrap);return input;}
    function dialog(title){
      const node=el('dialog',undefined,'confirmation-dialog library-tool-dialog feature-dialog play-dialog'),header=el('div',undefined,'modal-header'),body=el('div',undefined,'modal-body');
      const close=button('',()=>node.close(),'close-btn');root.OpenCabinetIcons.set(close,'x');close.setAttribute('aria-label',t('backup.close'));
      header.append(el('h2',title),close);node.append(header,body);document.body.append(node);
      node.addEventListener('close',()=>node.remove(),{once:true});return {node,body};
    }
    async function load(){
      if(loading)return loading;
      loading=invoke('get_playlists').then(value=>{const changed=JSON.stringify(lists)!==JSON.stringify(value);lists=value;if(changed)onChanged();return lists;}).finally(()=>{loading=null;});return loading;
    }
    async function persist(list){lists=await invoke('save_playlist',{playlist:list});onChanged();}
    function select(host,label,values,value=''){
      const node=el('select');for(const [id,name]of values){const option=el('option',name);option.value=id;node.append(option);}node.value=value;return field(host,label,node);
    }
    async function playlists(initialIds=[]){
      const {node,body}=dialog(t('playlists.title')),message=el('p','', 'feature-error');body.append(message);node.showModal();
      try{await load();if(!node.open)return;}catch(error){message.textContent=String(error);return;}
      let draft=null,busy=false;
      const toolbar=el('div',undefined,'feature-toolbar'),selector=el('select'),name=el('input'),search=el('input'),available=el('div',undefined,'play-available'),chosen=el('div',undefined,'play-chosen'),columns=el('div',undefined,'play-columns'),actions=el('div',undefined,'form-actions');
      selector.setAttribute('aria-label',t('playlists.title'));search.type='search';search.placeholder=t('playlists.search');search.setAttribute('aria-label',search.placeholder);name.maxLength=100;
      const create=button(t('playlists.new'),()=>set(null)),save=button(t('personal.save'),saveList,'primary-btn'),remove=button(t('playlists.delete'),removeList);
      toolbar.append(selector,create);body.append(toolbar);field(body,t('playlists.name'),name);
      const left=el('section'),right=el('section');left.append(el('h3',t('playlists.available')),search,available);right.append(el('h3',t('playlists.order')),chosen);columns.append(left,right);actions.append(remove,save);body.append(columns,actions);
      function options(){selector.replaceChildren();const option=el('option',t('playlists.new'));option.value='';selector.append(option);for(const list of lists){const row=el('option',list.name);row.value=list.id;selector.append(row);}}
      function set(id){const list=lists.find(list=>list.id===id);draft=list?{...list,games:[...list.games]}:{id:root.crypto.randomUUID(),name:'',games:[...new Set(initialIds)]};name.value=draft.name;selector.value=list?.id||'';remove.disabled=!list;render();}
      function render(){
        const games=getGames(),byId=new Map(games.map(game=>[game.id,game]));draft.games=draft.games.filter(id=>byId.has(id));chosen.replaceChildren();
        for(const [index,id]of draft.games.entries()){
          const game=byId.get(id),row=el('div',undefined,'play-list-row'),label=el('span',`${game.title} · ${game.platform}`),up=button('↑',()=>move(index,-1)),down=button('↓',()=>move(index,1)),del=button('×',()=>{draft.games.splice(index,1);render();});
          root.OpenCabinetIcons.set(up,'chevron-down');up.style.transform='rotate(180deg)';root.OpenCabinetIcons.set(down,'chevron-down');root.OpenCabinetIcons.set(del,'trash-2');
          up.disabled=busy||index===0;down.disabled=busy||index===draft.games.length-1;del.disabled=busy;
          up.setAttribute('aria-label',t('playlists.up',game.title));down.setAttribute('aria-label',t('playlists.down',game.title));del.setAttribute('aria-label',t('playlists.remove',game.title));row.append(label,up,down,del);chosen.append(row);
        }
        if(!draft.games.length)chosen.append(el('p',t('playlists.empty'),'help-text'));
        available.replaceChildren();const query=search.value.toLocaleLowerCase(),members=new Set(draft.games);
        const matches=getGames().filter(game=>!members.has(game.id)&&`${game.title} ${game.platform}`.toLocaleLowerCase().includes(query));
        for(const game of matches.slice(0,100)){const row=button(`${game.title} · ${game.platform}`,()=>{draft.games.push(game.id);render();},'secondary-btn play-add-game');row.disabled=busy;available.append(row);}
        if(matches.length>100)available.append(el('p',t('playlists.refine'),'help-text'));
      }
      function move(index,delta){const target=index+delta;[draft.games[index],draft.games[target]]=[draft.games[target],draft.games[index]];render();}
      function lock(value){busy=value;for(const input of [name,selector,search,save,create,remove])input.disabled=value;remove.disabled=value||!lists.some(list=>list.id===draft.id);render();}
      async function saveList(){if(busy)return;lock(true);message.textContent='';try{await persist({...draft,name:name.value.trim()});if(!node.open)return;options();set(draft.id);message.textContent=t('playlists.saved');}catch(error){message.textContent=String(error);}finally{if(node.open)lock(false);}}
      async function removeList(){if(busy||!await confirm(t('playlists.deleteConfirm')))return;lock(true);try{lists=await invoke('delete_playlist',{id:draft.id});onChanged();if(node.open){options();set(null);}}catch(error){message.textContent=String(error);}finally{if(node.open)lock(false);}}
      selector.onchange=()=>set(selector.value);search.oninput=render;options();set(initialIds.length?null:lists[0]?.id);name.focus();
    }
    async function addToPlaylist(ids){
      const {node,body}=dialog(t('playlists.add')),status=el('p','', 'feature-error'),actions=el('div',undefined,'feature-report-list');body.append(status,actions);node.showModal();
      try{await load();if(!node.open)return;for(const list of lists)actions.append(button(list.name,async()=>{for(const item of actions.querySelectorAll('button'))item.disabled=true;try{await persist({...list,games:[...new Set([...list.games,...ids])]});node.close();}catch(error){status.textContent=String(error);for(const item of actions.querySelectorAll('button'))item.disabled=false;}}));
        actions.append(button(t('playlists.new'),()=>{node.close();playlists(ids);},'primary-btn'));
      }catch(error){status.textContent=String(error);}
    }
    async function random(initial={}){
      const {node,body}=dialog(t('random.title')),filters=el('div',undefined,'play-filter-grid'),error=el('p','', 'feature-error'),result=el('section',undefined,'play-random-result'),actions=el('div',undefined,'form-actions');
      node.showModal();body.append(filters,error,result,actions);let picked=null;
      try{await load();if(!node.open)return;}catch(reason){error.textContent=String(reason);}
      const all=[['',t('random.any')]],platform=select(filters,t('msg.e0236ea3bc'),[...all,...[...new Set(getGames().map(game=>game.platform))].sort().map(name=>[name,name])],initial.platform||''),playlist=select(filters,t('playlists.title'),[...all,...lists.map(list=>[list.id,list.name])],initial.playlist||''),status=select(filters,t('personal.status'),[...all,...['unplayed','planned','playing','completed','abandoned'].map(value=>[value,t('personal.'+value)])]);
      const genre=el('input'),players=el('input');genre.type='text';players.type='number';players.min='1';players.max='999';field(filters,t('random.genre'),genre);field(filters,t('random.players'),players);
      const favorite=el('input'),unplayed=el('input');favorite.type=unplayed.type='checkbox';field(filters,t('personal.favorites'),favorite);field(filters,t('random.unplayed'),unplayed);
      const show=button(t(initial.pickOnly?'random.choose':'random.show'),()=>{}),play=button(t('random.play'),()=>{},'primary-btn');play.hidden=!!initial.pickOnly;
      play.onclick=async()=>{if(!picked)return;play.disabled=true;try{const game=picked;node.close();await launch(game);}catch(reason){onError(String(reason));}};
      function roll(){picked=choose(getGames(),{platform:platform.value,playlist:playlist.value,status:status.value,genre:genre.value.trim(),players:Number(players.value)||0,favorite:favorite.checked,unplayed:unplayed.checked},lists,picked?.id);result.replaceChildren();show.disabled=play.disabled=!picked;if(picked)result.append(el('h3',picked.title),el('p',picked.platform));else result.append(el('p',t('random.empty')));}
      const again=button(t('random.again'),roll);actions.append(again,show,play);for(const input of [platform,playlist,status,genre,players,favorite,unplayed])input.addEventListener('change',roll);roll();
      return new Promise(resolve=>{const old=play.onclick;play.onclick=async()=>{const game=picked;resolve(game);await old();};show.onclick=()=>{if(!picked)return;const game=picked;resolve(game);node.close();if(!initial.pickOnly)onPick(game);};node.addEventListener('close',()=>resolve(null),{once:true});});
    }
    async function actionEditor(host,gameId){
      const value=await invoke('get_game_launch_actions',{gameId});host.replaceChildren();host.append(el('p',t('actions.help'),'help-text'));
      for(const phase of ['before','after']){
        const section=el('section',undefined,'play-actions-section'),rows=el('div');section.append(el('h3',t('actions.'+phase)),rows,button(t('actions.add'),()=>{value[phase].push({executable:'',arguments:[],directory:'',wait:phase==='before'});render();}));host.append(section);
        function render(){rows.replaceChildren();for(const [index,action]of value[phase].entries()){
          const row=el('div',undefined,'play-action'),path=el('input'),args=el('textarea'),directory=el('input'),wait=el('input'),pathRow=el('div',undefined,'feature-toolbar');path.value=action.executable;args.value=action.arguments.join('\n');directory.value=action.directory;wait.type='checkbox';wait.checked=action.wait;
          path.setAttribute('aria-label',t('actions.program'));path.oninput=()=>action.executable=path.value;args.oninput=()=>action.arguments=args.value?args.value.split('\n'):[];directory.oninput=()=>action.directory=directory.value;wait.onchange=()=>action.wait=wait.checked;
          const browse=button(t('actions.browse'),async()=>{try{const chosen=await invoke('choose_launch_action');if(chosen&&row.isConnected){path.value=action.executable=chosen;}}catch(reason){onError(String(reason));}});
          pathRow.append(path,browse);field(row,t('actions.program'),pathRow);field(row,t('actions.arguments'),args);field(row,t('actions.directory'),directory);field(row,t('actions.wait'),wait);
          row.append(button(t('actions.remove'),()=>{value[phase].splice(index,1);render();}));rows.append(row);
        }}render();
      }
      return {value:()=>{if([...value.before,...value.after].some(action=>!action.executable.trim()))throw new Error(t('actions.invalid'));return value;}};
    }
    return {load,playlists,random,addToPlaylist,actionEditor,get lists(){return lists;}};
  }
  const api={create,matches,choose,ordered};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OpenCabinetPlay=api;
})(globalThis);
