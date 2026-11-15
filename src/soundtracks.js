// Only local soundtrack extras; never counted as gameplay.
(() => {
  const t=(...args)=>globalThis.OpenCabinetI18n.t(...args);
  const candidate=path=>/\.(?:cue|m3u8?)$/i.test(path||'');
  const time=value=>{if(!Number.isFinite(value))return '--:--';value=Math.max(0,Math.floor(value));return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;};
  function create({document,invoke,imageSource,getPreferences,onError=console.error,AudioClass=Audio}) {
    const get=id=>document.getElementById(id),audio=new AudioClass();audio.preload='metadata';
    let game=null,albums=[],album=null,index=-1,playback=null,request=0,selection=0,selected=null,timer=null,automatic=false;
    let shuffle=false,repeat=false,seeking=false,disposed=false,boundaryTimer=null,presentation='sidebar',explicitOpen=false;
    const modal=get('ost-player'),mini=get('ost-mini'),status=get('ost-status');
    function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;}
    function icon(el,key,name){
      if(el.dataset.ostIcon!==name){globalThis.OpenCabinetIcons.set(el,name);el.dataset.ostIcon=name;}
      el.title=t(key);el.setAttribute('aria-label',t(key));
      el.setAttribute('data-i18n-title',key);el.setAttribute('data-i18n-aria-label',key);
    }
    function compact(host,prefix){
      const make=(key,glyph,action)=>{const b=node('button','secondary-btn ost-icon-button');b.type='button';icon(b,key,glyph);b.onclick=action;return b;};
      const header=node('div','import-task-header ost-compact-header'),title=node('strong');title.id=prefix+'-title';
      const expand=make('ost.open','maximize',()=>{if(!modal.open)modal.showModal();state();});expand.id=prefix+'-open';expand.classList.add('ost-header-action');
      const move=make(prefix==='ost-mini'?'ost.dock':'ost.float',prefix==='ost-mini'?'panel-right':'picture-in-picture-2',()=>{presentation=prefix==='ost-mini'?'sidebar':'floating';state();});move.id=prefix+'-move';move.classList.add('ost-header-action');
      header.append(title,move,expand);
      const timeline=node('div','ost-timeline'),seek=node('input');seek.type='range';seek.min=0;seek.max=1000;seek.value=0;seek.id=prefix+'-seek';seek.setAttribute('aria-label',t('ost.seek'));
      const elapsed=node('span',null,'0:00 / --:--');elapsed.id=prefix+'-elapsed';timeline.append(seek,elapsed);
      const controls=node('div','ost-controls'),previous=make('ost.previous','skip-back',()=>next(-1)),toggleButton=make('ost.play','play',()=>toggle()),nextButton=make('ost.next','skip-forward',()=>next()),stopButton=make('ost.stop','square',halt);
      for(const [suffix,b]of [['prev',previous],['toggle',toggleButton],['next',nextButton],['stop',stopButton]])b.id=prefix+'-'+suffix;
      const shuffleButton=make('ost.shuffle','shuffle',()=>{shuffle=!shuffle;state();}),repeatButton=make('ost.repeat','repeat',()=>{repeat=!repeat;state();});
      shuffleButton.id=prefix+'-shuffle';repeatButton.id=prefix+'-repeat';controls.append(previous,toggleButton,nextButton,stopButton,shuffleButton,repeatButton);
      const volumeGroup=node('div','ost-volume-control'),mute=make('ost.mute','volume-2',()=>{audio.muted=!audio.muted;state();}),volume=node('input');
      mute.id=prefix+'-mute';volume.type='range';volume.min=0;volume.max=1;volume.step=.01;volume.value=.6;volume.id=prefix+'-volume';volume.setAttribute('aria-label',t('ost.volume'));volume.oninput=e=>setVolume(e.target.value);
      volumeGroup.append(mute,volume);controls.append(volumeGroup);
      const note=node('p','preference-help ost-compact-status');note.setAttribute('role','status');
      host.replaceChildren(header,timeline,controls,note);wireSeek(seek);
      return {host,title,elapsed,seek,toggle:toggleButton,previous,next:nextButton,shuffle:shuffleButton,repeat:repeatButton,mute,volume,note};
    }
    const views=[compact(mini,'ost-mini'),compact(get('ost-sidebar'),'ost-sidebar')];
    const floating=globalThis.OpenCabinetTaskWindows?.attach(mini);
    function button(label,action,icon){const b=document.createElement('button');b.type='button';b.className='secondary-btn';b.title=t(label);b.setAttribute('aria-label',t(label));b.onclick=action;if(icon)globalThis.OpenCabinetIcons.set(b,icon);else b.textContent=t(label);return b;}
    function state(){
      const active=!!album&&index>=0,available=(album||albums[0])?.tracks.some(t=>t.available)||false;
      const track=album?.tracks[index]||album?.tracks.find(t=>t.available);
      const showFloating=active&&presentation==='floating'&&!modal.open;
      if(floating){if(showFloating)floating.show();else floating.hide();}else mini.classList.toggle('hidden',!showFloating);
      get('ost-sidebar').classList.toggle('hidden',(!albums.length&&!explicitOpen)||presentation!=='sidebar');
      const playKey=audio.paused?'ost.play':'ost.pause',playIcon=audio.paused?'play':'pause';
      icon(get('ost-toggle'),playKey,playIcon);get('ost-toggle').disabled=!available;
      get('ost-track-title').textContent=track?.title||'';get('ost-track-artist').textContent=track?.artist||album?.artist||'';
      get('ost-prev').disabled=get('ost-next').disabled=!available;
      get('ost-shuffle').setAttribute('aria-pressed',String(shuffle));get('ost-repeat').setAttribute('aria-pressed',String(repeat));
      const muted=audio.muted||audio.volume===0;icon(get('ost-mute'),muted?'ost.unmute':'ost.mute',muted?'volume-x':'volume-2');get('ost-mute').setAttribute('aria-pressed',String(muted));get('ost-volume').value=audio.volume;
      for(const view of views){
        view.title.textContent=track?`${track.title} · ${album.title}`:album?.title||t('ost.title');view.title.title=view.title.textContent;
        icon(view.toggle,playKey,playIcon);view.toggle.disabled=view.previous.disabled=view.next.disabled=!available;
        view.shuffle.setAttribute('aria-pressed',String(shuffle));view.repeat.setAttribute('aria-pressed',String(repeat));
        icon(view.mute,muted?'ost.unmute':'ost.mute',muted?'volume-x':'volume-2');view.mute.setAttribute('aria-pressed',String(muted));view.volume.value=audio.volume;
        view.note.textContent=status.textContent;view.note.classList.toggle('hidden',!status.textContent);
      }
      const rows=get('ost-tracks').querySelectorAll('[data-track]');for(const row of rows){row.classList.toggle('selected',Number(row.dataset.track)===index);row.setAttribute('aria-current',String(Number(row.dataset.track)===index));}
      progress();
    }
    function render(){
      const select=get('ost-albums');select.replaceChildren();
      for(const a of albums){const option=document.createElement('option');option.value=a.path;option.textContent=a.title;select.append(option);}
      if(album)select.value=album.path;select.disabled=!albums.length;
      const cover=get('ost-cover'),path=album?.cover||game?.cover_path;
      cover.classList.toggle('hidden',!path);if(path)cover.src=imageSource(path);else cover.removeAttribute('src');
      const list=get('ost-tracks');list.replaceChildren();
      for(const [i,track] of (album?.tracks||[]).entries()){
        const row=button('ost.play',()=>void play(i));row.classList.add('ost-track');row.dataset.track=String(i);row.disabled=!track.available;
        const title=document.createElement('span');title.textContent=`${i+1}. ${track.title}`;
        const duration=document.createElement('span');duration.textContent=track.available?time(track.duration):t('ost.missing');row.replaceChildren(title,duration);list.append(row);
      }
      if(!albums.length){const p=document.createElement('p');p.textContent=t('ost.empty');list.append(p);}
      state();
    }
    function stop(clearAlbums=false){if(clearAlbums)albums=[];++request;clearTimeout(boundaryTimer);audio.onloadedmetadata=null;playback=null;album=clearAlbums?null:album||albums[0]||null;index=-1;automatic=false;audio.pause();audio.removeAttribute('src');audio.load();get('ost-seek').value=0;get('ost-elapsed').textContent='0:00 / --:--';status.textContent='';state();}
    function cancelSelection(){++selection;clearTimeout(timer);timer=null;}
    function halt(){cancelSelection();explicitOpen=false;presentation='sidebar';stop();}
    async function play(i,{silent=false}={}){
      const chosen=album;if(disposed||!chosen?.tracks[i]?.available)return;
      const version=++request;audio.pause();index=i;playback=null;status.textContent=t('ost.loading');state();
      try {
        const result=await invoke('prepare_ost_track',{id:game.id,album:chosen.path,index:i});
        if(version!==request||disposed)return;
        playback=result;audio.src=imageSource(result.path);
        audio.onloadedmetadata=()=>{if(version===request&&playback===result){audio.currentTime=result.start||0;progress();}};
        audio.load();await audio.play();if(version!==request){return;}
        status.textContent='';state();
      }catch(error){if(version!==request)return;status.textContent=t(silent?'ost.autoplayBlocked':'ost.playFailed',String(error));state();}
    }
    function next(delta=1){
      album||=albums[0];
      const available=(album?.tracks||[]).map((t,i)=>t.available?i:-1).filter(i=>i>=0);if(!available.length)return;
      const position=index<0?(delta<0?0:-1):available.indexOf(index);
      let i=shuffle&&delta>0?available[Math.floor(Math.random()*available.length)]:available[(position+delta+available.length)%available.length];
      if(shuffle&&available.length>1&&i===index)i=available[(available.indexOf(i)+1)%available.length];
      void play(i);
    }
    function ended(){if(!album)return;const later=album.tracks.findIndex((t,i)=>i>index&&t.available);if(shuffle||repeat||later>=0)next();else{audio.pause();state();}}
    function scheduleBoundary(){
      clearTimeout(boundaryTimer);if(playback?.end==null||audio.paused)return;
      const version=request,remaining=(playback.end-audio.currentTime)/audio.playbackRate;
      boundaryTimer=setTimeout(()=>{if(version!==request||!playback||audio.paused)return;
        if(audio.currentTime>=playback.end-0.015){audio.pause();ended();}else scheduleBoundary();
      },Math.max(10,remaining*1000));
    }
    let advancing=false;
    function progress(){
      const track=album?.tracks[index]||album?.tracks.find(t=>t.available);
      const start=playback?.start||0,end=playback?(playback.end??audio.duration):null;
      const duration=end==null?track?.duration:end-start,current=playback?Math.max(0,audio.currentTime-start):0;
      const label=`${time(current)} / ${time(duration)}`,value=Number.isFinite(duration)&&duration>0?Math.min(1000,current/duration*1000):0;
      get('ost-elapsed').textContent=label;get('ost-seek').disabled=!playback;
      if(!seeking)get('ost-seek').value=value;
      for(const view of views){view.elapsed.textContent=label;view.seek.disabled=!playback;if(!seeking)view.seek.value=value;}
      if(playback?.end!=null&&audio.currentTime>=playback.end-0.02&&!audio.paused&&!advancing){advancing=true;ended();queueMicrotask(()=>advancing=false);}
    }
    function wireSeek(slider){slider.oninput=()=>{seeking=true;};slider.onchange=e=>{
      if(playback){const start=playback.start||0,end=playback.end??audio.duration;if(Number.isFinite(end)&&end>start)audio.currentTime=start+(end-start)*Number(e.target.value)/1000;}seeking=false;progress();};}
    function setVolume(value){audio.volume=Number(value);if(audio.volume>0)audio.muted=false;state();}
    async function load(gameValue,{token=null}={}){
      const result=await invoke('get_game_soundtracks',{id:gameValue.id});
      if(token!==null&&token!==selection)return false;
      game=gameValue;albums=result.albums;album=albums[0]||null;index=-1;playback=null;
      get('ost-player-title').textContent=`${t('ost.title')} · ${game.title}`;
      status.textContent=result.warnings.join('\n')||(!albums.length&&explicitOpen?t('ost.empty'):'');render();return true;
    }
    async function open(gameValue,{expandPlaying=false}={}){cancelSelection();const token=selection;presentation='sidebar';explicitOpen=true;
      const sameGame=game?.id===gameValue.id||(expandPlaying&&gameValue.regions?.some(region=>region.game.id===game?.id));
      if(sameGame&&index>=0){if(expandPlaying&&!audio.paused&&!modal.open)modal.showModal();state();return true;}
      stop(true);game=gameValue;render();
      get('ost-player-title').textContent=`${t('ost.title')} · ${game.title}`;status.textContent=t('ost.loading');
      try{return await load(gameValue,{token});}
      catch(error){status.textContent=String(error);onError(error);return false;}}
    async function launch(gameValue,path){
      if(!candidate(path))return false;
      const found=await invoke('get_disc_soundtrack',{id:gameValue.id,path});if(!found)return false;
      halt();game=gameValue;albums=[found];album=found;index=-1;
      get('ost-player-title').textContent=`${t('ost.title')} · ${game.title}`;status.textContent='';render();
      const first=found.tracks.findIndex(t=>t.available);if(first>=0)await play(first);return true;
    }
    function select(gameValue,{floating=false}={}){
      if(selected===gameValue?.id)return;selected=gameValue?.id??null;cancelSelection();
      const autoplay=getPreferences().autoplayOST;
      if(!autoplay&&index>=0)return; // Explicit music can continue while browsing.
      explicitOpen=false;stop(true);presentation=floating?'floating':'sidebar';if(!gameValue)return;
      const token=selection;timer=setTimeout(async()=>{
        try{if(!await load(gameValue,{token})||token!==selection)return;
          if(autoplay&&album){automatic=true;const first=album.tracks.findIndex(t=>t.available);if(first>=0)await play(first,{silent:true});}
        }catch(error){if(token===selection)console.error('OST:',error);}
      },450);
    }
    async function manage(gameValue,host){
      const content=document.createElement('div');host.replaceChildren(content);let alive=true,busy=false;
      const actions=document.createElement('div');actions.className='ost-editor-actions';const list=document.createElement('div'),message=document.createElement('p');message.className='preference-help';
      const help=document.createElement('p');help.className='preference-help';help.textContent=t('ost.folderHelp');
      async function run(fn){if(busy||!alive)return;busy=true;for(const b of actions.children)b.disabled=true;
        try{await fn();}catch(error){if(alive)message.textContent=String(error);}finally{busy=false;for(const b of actions.children)b.disabled=false;}}
      async function refresh(){const result=await invoke('get_game_soundtracks',{id:gameValue.id});if(!alive)return;
        list.replaceChildren();message.textContent=result.warnings.join('\n');
        for(const a of result.albums){const b=button('ost.play',()=>{void open(gameValue).then(loaded=>{if(loaded&&game?.id===gameValue.id){album=albums.find(v=>v.path===a.path);render();const first=album?.tracks.findIndex(t=>t.available);if(first>=0)void play(first);}});},'disc-3');
          b.textContent=`${a.title} · ${a.tracks.length} ${t('ost.tracks')}`;list.append(b);}
        if(!result.albums.length)list.textContent=t('ost.empty');}
      actions.append(button('ost.add',()=>void run(async()=>{message.textContent=t('ost.loading');if(await invoke('import_game_soundtrack',{id:gameValue.id}))await refresh();}),'plus'),
        button('ost.folder',()=>void run(()=>invoke('open_game_ost_folder',{id:gameValue.id})),'folder-open'),button('ost.refresh',()=>void run(refresh),'rotate-ccw'));
      // Keep labels visible beside the icons in the editor.
      for(const b of actions.children){const span=document.createElement('span');span.textContent=b.title;b.append(span);}
      content.append(actions,help,list,message);await run(refresh);return ()=>{alive=false;};
    }
    const toggle=()=>{album||=albums[0];if(!album)return;
      if(!playback){void play(index>=0?index:album.tracks.findIndex(t=>t.available));return;}
      if(audio.paused){if(playback.end!=null&&audio.currentTime>=playback.end-0.05)audio.currentTime=playback.start||0;audio.play().catch(e=>{status.textContent=t('ost.playFailed',String(e));});}else audio.pause();};
    get('ost-close').onclick=()=>modal.close();
    modal.addEventListener('close',()=>{cancelSelection();state();});
    get('ost-toggle').onclick=toggle;get('ost-stop').onclick=halt;
    get('ost-prev').onclick=()=>next(-1);get('ost-next').onclick=()=>next();
    get('ost-shuffle').onclick=()=>{shuffle=!shuffle;state();};get('ost-repeat').onclick=()=>{repeat=!repeat;state();};
    get('ost-mute').onclick=()=>{audio.muted=!audio.muted;state();};
    get('ost-volume').oninput=e=>setVolume(e.target.value);audio.volume=0.6;
    wireSeek(get('ost-seek'));
    get('ost-albums').onchange=e=>{++request;audio.pause();album=albums.find(a=>a.path===e.target.value);index=-1;playback=null;render();const first=album?.tracks.findIndex(t=>t.available);if(first>=0)void play(first);};
    audio.addEventListener('timeupdate',progress);audio.addEventListener('ended',ended);audio.addEventListener('play',state);audio.addEventListener('pause',state);
    for(const event of ['playing','seeked','ratechange'])audio.addEventListener(event,scheduleBoundary);
    for(const event of ['pause','waiting'])audio.addEventListener(event,()=>clearTimeout(boundaryTimer));
    audio.addEventListener('error',()=>{if(album&&index>=0)status.textContent=t('ost.playFailed',audio.error?.message||t('ost.codec'));state();});
    state();return {open,launch,select,manage,stop:halt,preferencesChanged(){selected=null;if(!getPreferences().autoplayOST){cancelSelection();if(automatic)stop();}},
      dispose(){disposed=true;halt();audio.onloadedmetadata=null;if(modal.open)modal.close();}};
  }
  globalThis.OpenCabinetOST={candidate,time,create};
})();
