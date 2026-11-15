// Shared launch presentation settings and main-window orchestration.
(() => {
  const defaults = Object.freeze({ enabled:true, useThemeColor:true, color:'#14161e', useBackground:true,
    mode:'auto', seconds:8, timeoutSeconds:5 });
  const seconds = (value, fallback) => Number.isFinite(Number(value)) && Number(value)>=1 && Number(value)<=120 ? Number(value) : fallback;
  function normalize(value={}) {
    value ||= {};
    return { ...defaults, ...Object.fromEntries(['enabled','useThemeColor','useBackground'].map(key=>[key,
      typeof value[key]==='boolean'?value[key]:defaults[key]])),
      color:/^#[0-9a-f]{6}$/i.test(value.color)?value.color:defaults.color,
      mode:value.mode==='fixed'?'fixed':'auto', seconds:seconds(value.seconds,defaults.seconds),
      timeoutSeconds:seconds(value.timeoutSeconds,defaults.timeoutSeconds) };
  }
  function editionArtwork(game, discId) {
    const images=game.images||[], first=(...kinds)=>kinds.map(kind=>images.find(image=>image.kind===kind&&image.path)?.path).find(Boolean)||null;
    const normalDiscs=images.filter(image=>image.kind==='disc'&&image.path);
    const discs=normalDiscs.length?normalDiscs:images.filter(image=>image.kind==='fanart_disc'&&image.path);
    const discIndex=Math.max(0,(game.discs||[]).findIndex(disc=>disc.id===discId));
    const disc=discs[discIndex]?.path||discs[0]?.path;
    return { logo:first('logo'), background:first('background','fanart_background'),
      media:disc||first('cart_label','cart_front','fanart_cart_front'), spinning:!!disc };
  }
  function artwork(game,discId,alternatives=[]) {
    const own=editionArtwork(game,discId);
    if(own.logo&&own.media)return own;
    const index=Math.max(0,(game.discs||[]).findIndex(disc=>disc.id===discId));
    const backups=alternatives.map(edition=>editionArtwork(edition,edition.discs?.[index]?.id));
    const medium=own.media?own:backups.find(art=>art.media);
    return {...own,logo:own.logo||backups.find(art=>art.logo)?.logo||null,
      media:medium?.media||null,spinning:!!medium?.spinning};
  }
  function editor(document) {
    const fields=Object.fromEntries(Object.keys(defaults).map(key=>[key,document.getElementById(`launch-screen-${key}`)]));
    const read=()=>normalize(Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,
      typeof defaults[key]==='boolean'?input.checked:input.value])));
    function sync(busy=false) {
      for(const [key,input] of Object.entries(fields)) input.disabled=busy||(key!=='enabled'&&!fields.enabled.checked);
      fields.color.disabled ||= fields.useThemeColor.checked;
      fields.seconds.disabled ||= fields.mode.value!=='fixed';
      fields.timeoutSeconds.disabled ||= fields.mode.value!=='auto';
      document.getElementById('launch-screen-fixed-options').classList.toggle('hidden',fields.mode.value!=='fixed');
      document.getElementById('launch-screen-auto-options').classList.toggle('hidden',fields.mode.value!=='auto');
    }
    for(const input of Object.values(fields))input.addEventListener('change',()=>sync());
    return {read,sync,load(value){const settings=normalize(value);for(const [key,input] of Object.entries(fields)){
      if(typeof defaults[key]==='boolean')input.checked=settings[key];else input.value=String(settings[key]);}sync();},
      changed(value){return JSON.stringify(read())!==JSON.stringify(normalize(value));}};
  }
  function create({invoke,getPreferences,listen,themeColor=()=>defaults.color,t=key=>key,onError=console.error}) {
    let active=null,starting=false,subscription=null,closedWhileStarting=new Set();
    return {
      get active(){return starting||active!==null;},
      async begin(game,discId,alternatives=[]) {
        const settings=normalize(getPreferences().launchScreen);
        if(!settings.enabled)return null;
        // One native overlay per launch; never let a second request cover the first.
        if(starting||active!==null)throw new Error(t('launchScreen.busy'));
        starting=true;
        closedWhileStarting.clear();
        try {
          subscription ||= listen?.('launch-screen-closed',event=>{
            if(starting)closedWhileStarting.add(event.payload);
            if(active===event.payload)active=null;
          });
          await subscription;
          const id=await invoke('show_launch_screen',{presentation:{...artwork(game,discId,alternatives),settings,
            title:game.title||'',color:settings.useThemeColor?themeColor():settings.color,
            loading:t('launchScreen.loading'),dismiss:t('launchScreen.dismiss')}});
          active=closedWhileStarting.has(id)?null:id;
          return id;
        } catch(error) { onError(error);return null; }
        finally{starting=false;}
      },
      async dismiss(id=active) {
        if(id==null)return;
        if(active===id)active=null;
        try{await invoke('dismiss_launch_screen',{id});}catch(error){onError(error);}
      },
    };
  }
  globalThis.OpenCabinetLaunchScreen={defaults,normalize,artwork,editor,create};
})();
