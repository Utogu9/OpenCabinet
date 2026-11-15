(() => {
  async function iconFrames(path,toUrl,document=globalThis.document) {
    if(!path)return null;
    const image=await new Promise((resolve,reject)=>{const image=new Image();image.crossOrigin='anonymous';image.onload=()=>resolve(image);image.onerror=reject;image.src=toUrl(path);});
    const frames=[];
    for(const size of [16,24,32,48,64,128,256]){
      const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
      const context=canvas.getContext('2d');const scale=Math.min(size*.92/image.naturalWidth,size*.92/image.naturalHeight);
      const width=image.naturalWidth*scale,height=image.naturalHeight*scale;
      context.drawImage(image,(size-width)/2,(size-height)/2,width,height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob)throw Error('Could not encode shortcut icon');frames.push({size,png:Array.from(new Uint8Array(await blob.arrayBuffer()))});
      canvas.width=canvas.height=1;
    }
    return frames;
  }
  function create({invoke,listen,games,launch,canLaunch,images,toUrl,showToast,focus}){
    const t=(key,...args)=>globalThis.OpenCabinetI18n.t(key,...args);
    let draining=false,again=false;
    async function drain(){if(draining){again=true;return;}draining=true;
      try{do{again=false;const ids=await invoke('take_shortcut_requests');for(const id of ids||[]){
        const game=games().find(game=>game.id===id);if(!game)throw Error(t('shortcuts.missing'));
        if(!canLaunch()){showToast(t('shortcuts.busy'),true);continue;}
        await focus?.();await launch(game);
      }}while(again);}catch(error){showToast(String(error),true);}finally{draining=false;}}
    return {
      async start(){await listen('shortcut-request-available',()=>void drain());await drain();},
      async save(game){let frames=null;
        const editions=[game,...(game.regions||[]).map(region=>region.game)];
        const logo=editions.flatMap(edition=>images(edition)||[]).find(image=>image.kind==='logo'&&image.path)?.path;
        try{frames=await iconFrames(logo,toUrl);}catch(error){console.error('Shortcut logo:',error);}
        try{const destination=await invoke('create_game_shortcut',{gameId:game.id,iconFrames:frames});
          if(destination)showToast(t('shortcuts.created',destination));}catch(error){showToast(String(error),true);}
      },
    };
  }
  globalThis.OpenCabinetShortcuts={create,iconFrames};
})();
