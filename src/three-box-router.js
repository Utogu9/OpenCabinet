// Bundled and explicitly enabled local WebGL models share the existing controls.
(() => {
  const moduleTasks=new Map();
  const load = model => {
    if(!moduleTasks.has(model))moduleTasks.set(model,(model==='switch'
      ? import('./three-switch-viewer.js') : import('./three-box-viewer.js'))
      .catch(error=>{moduleTasks.delete(model);throw error;}));
    return moduleTasks.get(model);
  };
  function createRouter(host, options, createLegacy, profileFor, resolveSettings, loadModule = load) {
    let viewer=null, backend=null, pending=null, generation=0, disposed=false, open=false, lock='free';
    let commands=[];
    const isThree=()=>backend?.startsWith('three:');
    function release() { generation++; viewer?.dispose(); viewer=null; backend=null; commands=[]; }
    function legacy() { backend='css';viewer=createLegacy(host,options);viewer.setRotationLock?.(lock);viewer.update(...pending); }
    const api = {
      update(game,images,settings=null) {
        if(disposed)return;
        pending=[game,images,settings];
        const profile=profileFor(game.platform,null,game.rom_path,resolveSettings(settings,game.box_3d));
        const model=profile.variant==='dreamcast' && ['jewel','jewelPal'].includes(profile.id) ? 'dreamcast'
          : profile.id==='switch' && globalThis.OpenCabinetLocalModels?.switch ? 'switch' : null;
        const desired=model ? `three:${model}` : 'css';
        if(backend===desired) {viewer?.update(...pending);return;}
        release();open=false;
        if(desired==='css') {legacy();return;}
        backend=desired;const token=generation;
        loadModule(model).then(module=>{
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
          console.error(`${model} WebGL viewer unavailable; using the existing viewer.`,error);
          viewer?.dispose();viewer=null;
          host.classList.remove('game-box-webgl');delete host.dataset.renderer;
          legacy();
        });
      },
      get canOpen() {return viewer?.canOpen ?? !!isThree();},
      get isOpen() {return viewer?.isOpen ?? open;},
      get rotationLock() {return lock;},
      setRotationLock(value) {if(['free','x','y'].includes(value)){lock=value;viewer?.setRotationLock(value);}},
      setOpen(value,animate=true) {open=!!value;return viewer?.setOpen(open,animate) ?? !!isThree();},
      toggleOpen() {return api.setOpen(!api.isOpen);},
      readManual(...args) {return viewer?.readManual?.(...args) ?? false;},
      clear() {release();pending=null;open=false;options.onOpenState?.({canOpen:false,open:false});},
      dispose() {api.clear();disposed=true;},
    };
    for(const method of ['zoom','reset','toggleSide','showBack','refreshManual','returnManual']) api[method]=(...args)=>{
      if(viewer)return viewer[method]?.(...args);
      if(isThree())commands.push([method,args]);
    };
    return api;
  }
  globalThis.OpenCabinetThreeBoxes={createRouter};
})();
