(function(root) {
  const fallback='"%ROM%"';
  function recommendation(presets, name, executable) {
    const stem=String(executable||'').split(/[\\/]/).pop().toLowerCase();
    const matches=(text,p)=>p.aliases.some(alias=>text.startsWith(alias)&&(!text[alias.length]||!/[a-z]/.test(text[alias.length])));
    return presets.find(p=>matches(stem,p)) || presets.find(p=>matches(String(name||'').trim().toLowerCase(),p)) || null;
  }
  function create({name,path,args,button,editing,load}) {
    let presets=[],automatic=!editing?.value,last=args.value||fallback,revision=0,nameEdited=false;
    const refresh=()=> {
      if(!editing?.value&&!nameEdited) {
        const detected=recommendation(presets,'',path.value);
        if(detected)name.value=detected.name;
      }
      if(editing?.value)automatic=false;
      if(!automatic||args.value!==last&&args.value.trim())return;
      const preset=recommendation(presets,name.value,path.value);
      args.value=last=preset?.arguments||fallback;
    };
    const identityChanged=()=>{const current=++revision;queueMicrotask(()=>{if(current===revision)refresh();});};
    name.addEventListener('input',()=>{nameEdited=true;identityChanged();});path.addEventListener('input',identityChanged);path.addEventListener('change',identityChanged);
    args.addEventListener('input',()=>{automatic=false;});
    button?.addEventListener('click',()=>{const preset=recommendation(presets,name.value,path.value);args.value=last=preset?.arguments||fallback;automatic=!editing?.value;});
    Promise.resolve(load).then(value=>{presets=value;refresh();}).catch(()=>{});
    return { reset(){revision++;automatic=true;nameEdited=false;args.value=last=fallback;refresh();},edit(){revision++;automatic=false;nameEdited=true;},refresh };
  }
  root.OpenCabinetEmulatorDefaults={create,recommendation,fallback};
})(globalThis);
