// Only Dreamcast uses WebGL in this local experiment. Other formats keep their viewer.
(() => {
  let moduleTask;
  const load = () => moduleTask ??= import('./three-box-viewer.js').catch(error => { moduleTask=null; throw error; });
  function createRouter(host, options, createLegacy, profileFor, resolveSettings, loadModule = load) {
    let viewer=null, backend=null, pending=null, generation=0, disposed=false, open=false, lock='free';
    let commands=[];
    function release() { generation++; viewer?.dispose(); viewer=null; backend=null; commands=[]; }
    function legacy() { backend='css';viewer=createLegacy(host,options);viewer.setRotationLock?.(lock);viewer.update(...pending); }
    const api = {
      update(game,images,settings=null) {
        if(disposed)return;
        pending=[game,images,settings];
        const profile=profileFor(game.platform,null,game.rom_path,resolveSettings(settings,game.box_3d));
        const desired=profile.variant==='dreamcast' && ['jewel','jewelPal'].includes(profile.id) ? 'three' : 'css';
        if(backend===desired) {viewer?.update(...pending);return;}
        release();open=false;
        if(desired==='css') {legacy();return;}
        backend='three';const token=generation;
        loadModule().then(module=>{
          if(disposed||token!==generation)return null;
          return module.createViewer(host,{...options,isCurrent:()=>!disposed&&token===generation});
        }).then(created=>{
          if(!created)return;
          if(disposed||token!==generation) {created.dispose();return;}
          viewer=created;viewer.setRotationLock(lock);viewer.update(...pending);
          if(open)viewer.setOpen(open,false);
          const queued=commands;commands=[];queued.forEach(([name,args])=>viewer[name]?.(...args));
        }).catch(error=>{
          if(disposed||token!==generation)return;
          console.error('Dreamcast WebGL viewer unavailable; using the existing viewer.',error);
          host.classList.remove('game-box-webgl');delete host.dataset.renderer;
          legacy();
        });
      },
      get canOpen() {return viewer?.canOpen ?? backend==='three';},
      get isOpen() {return viewer?.isOpen ?? open;},
      get rotationLock() {return lock;},
      setRotationLock(value) {if(['free','x','y'].includes(value)){lock=value;viewer?.setRotationLock(value);}},
      setOpen(value,animate=true) {open=!!value;return viewer?.setOpen(open,animate) ?? backend==='three';},
      toggleOpen() {return api.setOpen(!api.isOpen);},
      readManual(...args) {return viewer?.readManual?.(...args) ?? false;},
      clear() {release();pending=null;open=false;options.onOpenState?.({canOpen:false,open:false});},
      dispose() {api.clear();disposed=true;},
    };
    for(const method of ['zoom','reset','toggleSide','showBack','refreshManual','returnManual']) api[method]=(...args)=>{
      if(viewer)return viewer[method]?.(...args);
      if(backend==='three')commands.push([method,args]);
    };
    return api;
  }
  globalThis.OpenCabinetThreeBoxes={createRouter};
})();
