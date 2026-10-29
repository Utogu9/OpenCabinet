// Themes contain values and known layout slots; never executable CSS or scripts.
(() => {
  const FORMAT = 'OpenCabinet Theme', CACHE = 'opencabinet.activeTheme';
  const COLORS = {
    background:'--bg-color', surface:'--card-bg', hover:'--card-hover-bg', dialog:'--modal-bg',
    sidebar:'--sidebar-bg', titlebar:'--titlebar-bg', accent:'--accent-color', accentHover:'--accent-hover',
    text:'--text-main', muted:'--text-muted', border:'--border-color', danger:'--danger-color',
    dangerHover:'--danger-hover', success:'--success-color', warning:'--warning-text', buttonText:'--button-text',
  };
  const SECTIONS = ['logo','identity','media','play','summary','information','description'];
  const FIELDS = ['release','developer','publisher','playtime','genre','mode','file','lastPlayed','players',
    'totalGames','emulator','lastGame','sessions','totalTime','mostPlayed'];
  const PANELS = ['library','catalog','details'];
  const t = (key, ...values) => globalThis.OpenCabinetI18n.t(key, ...values);
  const copy = value => JSON.parse(JSON.stringify(value));
  const defaults = {
    format:FORMAT, version:1, id:'builtin-dark', name:'OpenCabinet', author:'OpenCabinet',
    colors:{background:'#0f1115',surface:'#181c24',hover:'#222733',dialog:'#151820',sidebar:'#13161c',titlebar:'#0b0d11',
      accent:'#3b82f6',accentHover:'#2563eb',text:'#f3f4f6',muted:'#9ca3af',border:'#292d35',danger:'#ef4444',dangerHover:'#dc2626',success:'#10b981',warning:'#f59e0b',buttonText:'#ffffff'},
    layout:{panels:[...PANELS],libraryWidth:220,detailsWidth:420,coverSize:160,gap:20,radius:8,
      sections:SECTIONS.map(id=>({id,visible:true})),hiddenFields:[]},
  };
  const builtins = [defaults,
    {...copy(defaults),id:'builtin-light',name:'Paper',colors:{...defaults.colors,background:'#eef1f5',surface:'#ffffff',hover:'#e1e7ef',dialog:'#ffffff',sidebar:'#f7f8fa',titlebar:'#e7ebf0',text:'#192332',muted:'#536174',border:'#ced5df',accent:'#2463c5',accentHover:'#194e9e'}},
    {...copy(defaults),id:'builtin-forest',name:'Forest',colors:{...defaults.colors,background:'#101a18',surface:'#192924',hover:'#254036',dialog:'#14221e',sidebar:'#12201b',titlebar:'#0c1511',accent:'#2ca87a',accentHover:'#21805d',text:'#edf6ef',muted:'#a1b6a9',border:'#30483b'}},
  ];
  const invalid = () => new Error(t('themes.invalid'));
  function keys(value, names) { return value && typeof value==='object' && !Array.isArray(value)
    && Object.keys(value).length===names.length && names.every(name=>Object.prototype.hasOwnProperty.call(value,name)); }
  function permutation(values, names) { return Array.isArray(values) && values.length===names.length
    && new Set(values).size===names.length && values.every(value=>names.includes(value)); }
  function validate(value) {
    if(!keys(value,['format','version','id','name','author','colors','layout']) || value.format!==FORMAT || value.version!==1
      || typeof value.id!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)
      || typeof value.name!=='string' || !value.name.trim() || [...value.name].length>100
      || typeof value.author!=='string' || [...value.author].length>100 || !keys(value.colors,Object.keys(COLORS))
      || Object.values(value.colors).some(color=>typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color))) throw invalid();
    const l=value.layout;
    if(!keys(l,['panels','libraryWidth','detailsWidth','coverSize','gap','radius','sections','hiddenFields'])
      || !permutation(l.panels,PANELS) || !Array.isArray(l.sections) || !permutation(l.sections.map(s=>s?.id),SECTIONS)
      || l.sections.some(s=>!keys(s,['id','visible'])||typeof s.visible!=='boolean')
      || !Array.isArray(l.hiddenFields) || new Set(l.hiddenFields).size!==l.hiddenFields.length || l.hiddenFields.some(f=>!FIELDS.includes(f))) throw invalid();
    for(const [key,min,max] of [['libraryWidth',160,420],['detailsWidth',260,800],['coverSize',100,320],['gap',0,48],['radius',0,24]])
      if(!Number.isInteger(l[key])||l[key]<min||l[key]>max) throw invalid();
    return copy(value);
  }
  function validateLibrary(value) {
    if(!keys(value,['format','version','active','themes'])||value.format!=='OpenCabinet Themes'||value.version!==1||!Array.isArray(value.themes)||value.themes.length>100) throw invalid();
    const themes=value.themes.map(validate);
    if(themes.some(theme=>!theme.id.startsWith('user-'))||new Set(themes.map(theme=>theme.id)).size!==themes.length
      || ![...builtins,...themes].some(theme=>theme.id===value.active)) throw invalid();
    return {...value,themes};
  }
  const sectionSelectors = {
    logo:['#details-logo-container'],identity:['#details-title','#details-platform'],media:['#details-gallery'],
    play:['#btn-play-game','.platform-play-actions'],summary:['.details-meta-grid'],
    information:['#game-information','.details-info-box.platform-only'],description:['#game-description'],
  };
  const fieldIds = ['details-release-date','details-developer','details-publisher','details-play-time','details-genre','details-game-mode','details-rom-file','details-last-played','details-max-players',
    'platform-total-games','platform-default-emulator','platform-last-game','platform-sessions','platform-total-time','platform-most-game'];
  const applied = new WeakMap();
  function apply(value, {document=globalThis.document,window=globalThis.window}={}) {
    const theme=validate(value), root=document.documentElement, l=theme.layout;
    for(const [key,property] of Object.entries(COLORS)) root.style.setProperty(property,theme.colors[key]);
    root.style.setProperty('--accent-soft',theme.colors.accent+'26');root.style.setProperty('--accent-border',theme.colors.accent+'4d');
    root.style.setProperty('--warning-bg',theme.colors.warning+'1f');root.style.setProperty('--warning-border',theme.colors.warning+'4d');
    for(const [key,property] of [['libraryWidth','--library-width'],['coverSize','--cover-size'],['gap','--library-gap'],['radius','--ui-radius']]) root.style.setProperty(property,l[key]+'px');
    root.style.setProperty('--cover-height',l.coverSize*1.25+'px');
    const rgb=theme.colors.background.match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16));
    root.style.colorScheme=(rgb[0]*.299+rgb[1]*.587+rgb[2]*.114)>160?'light':'dark';
    root.dataset.theme=theme.id;
    const previous=applied.get(document), main=document.querySelector('main');
    const panelNodes={library:document.querySelector('.library-sidebar'),catalog:document.getElementById('catalog-scroll'),details:document.getElementById('game-details-panel')};
    const resizer=document.getElementById('details-resizer'),left=l.panels.indexOf('details')<l.panels.indexOf('catalog');
    if(resizer) resizer.dataset.side=left?'left':'right';
    if(main&&PANELS.every(id=>panelNodes[id])&&JSON.stringify(previous?.panels)!==JSON.stringify(l.panels)) {
      const focus=document.activeElement;
      l.panels.forEach(id=>{if(id==='details'&&!left&&resizer)main.appendChild(resizer);main.appendChild(panelNodes[id]);if(id==='details'&&left&&resizer)main.appendChild(resizer);});
      if(focus&&main.contains(focus))focus.focus({preventScroll:true});
    }
    const content=document.getElementById('details-content');
    for(const section of l.sections) for(const selector of sectionSelectors[section.id]) {
      const node=content?.querySelector(selector);if(!node)continue;
      node.setAttribute('data-theme-hidden',String(!section.visible));
      if(JSON.stringify(previous?.sections?.map(s=>s.id))!==JSON.stringify(l.sections.map(s=>s.id))) content.appendChild(node);
    }
    FIELDS.forEach((field,index)=>document.getElementById(fieldIds[index])?.closest('.meta-item')?.setAttribute('data-theme-hidden',String(l.hiddenFields.includes(field))));
    // The console last-played date shares the same visibility choice as games.
    document.getElementById('platform-last-played')?.closest('.meta-item')?.setAttribute('data-theme-hidden',String(l.hiddenFields.includes('lastPlayed')));
    if(panelNodes.details) panelNodes.details.style.width=l.detailsWidth+'px';
    applied.set(document,copy(l));
    if(window?.CustomEvent) window.dispatchEvent(new window.CustomEvent('opencabinet:themechange',{detail:{layout:copy(l)}}));
    return theme;
  }
  function create({document=globalThis.document,window=globalThis.window,invoke,confirm=async()=>false}={}) {
    let library={format:'OpenCabinet Themes',version:1,active:defaults.id,themes:[]},draft=null,busy=false,loaded=false,ui=null,loadPromise=null;
    const get=id=>document.getElementById(id),themes=()=>[...builtins,...library.themes];
    const active=()=>themes().find(theme=>theme.id===library.active)||defaults;
    const freshId=()=> 'user-'+window.crypto.randomUUID();
    function activate(theme,cache=true) { apply(theme,{document,window});if(cache)try{window.localStorage.setItem(CACHE,JSON.stringify(theme));}catch{/* Native storage remains authoritative. */} }
    try { const cached=JSON.parse(window.localStorage.getItem(CACHE)||'null');if(cached)activate(validate(cached),false); } catch {/* An invalid cache never supplies executable styles. */}
    function status(message,error=false) {if(!ui)return;const node=get(draft?'theme-editor-status':'themes-status');node.textContent=message;node.classList.toggle('error-message',error);}
    function controls() {
      if(!ui)return;
      for(const id of ['preferences-panel-themes','preferences-panel-theme-editor']) get(id).querySelectorAll('button,input,select').forEach(node=>{node.disabled=busy||!loaded||node.dataset.edgeDisabled==='true';});
      ui.onBusyChange();
    }
    async function perform(action) {
      if(busy||!loaded)return;
      busy=true;controls();status('');
      try {await action();}catch(error){status(String(error),true);}
      finally{busy=false;controls();}
    }
    async function persist(next) {
      const checked=validateLibrary(next);await invoke('save_theme_library',{library:checked});
      library=checked;activate(active());renderList();
    }
    function button(label,action,className='secondary-btn') {
      const node=document.createElement('button');node.type='button';node.className=className;node.textContent=label;node.onclick=action;return node;
    }
    function renderList() {
      if(!ui)return;
      const list=get('theme-list');list.replaceChildren();
      for(const theme of themes()) {
        const card=document.createElement('article');card.className='theme-card';card.dataset.themeId=theme.id;
        const header=document.createElement('div'),name=document.createElement('h4');name.textContent=theme.name;
        const author=document.createElement('p');author.className='help-text';author.textContent=theme.author;
        header.append(name,author);const swatches=document.createElement('div');swatches.className='theme-swatches';swatches.setAttribute('aria-hidden','true');
        for(const key of ['background','surface','accent','text']){const swatch=document.createElement('span');swatch.style.backgroundColor=theme.colors[key];swatches.appendChild(swatch);}
        const actions=document.createElement('div');actions.className='theme-card-actions';
        const selected=theme.id===library.active;
        const use=button(t(selected?'themes.active':'themes.use'),()=>perform(async()=>{await persist({...library,active:theme.id});status(t('themes.applied',theme.name));}),selected?'secondary-btn':'primary-btn');
        use.setAttribute('aria-pressed',String(selected));actions.append(use,button(t('themes.edit'),()=>edit(theme)),button(t('themes.export'),()=>perform(async()=>{await invoke('export_theme',{theme});})));
        if(theme.id.startsWith('user-'))actions.append(button(t('themes.delete'),()=>perform(async()=>{
          if(!await confirm(t('themes.delete'),t('themes.deleteConfirm',theme.name)))return;
          await persist({...library,active:selected?defaults.id:library.active,themes:library.themes.filter(item=>item.id!==theme.id)});
        })));
        card.append(header,swatches,actions);list.appendChild(card);
      }
      controls();
    }
    function preview() {
      if(!draft)return;
      try {
        draft.name=get('theme-name').value;draft.author=get('theme-author').value;
        const checked=validate(draft);activate(checked,false);
        const preview=get('theme-layout-preview');preview.replaceChildren();
        for(const id of checked.layout.panels){const node=document.createElement('div');node.className='theme-preview-'+id;node.textContent=t('themes.panel.'+id);if(id==='details')checked.layout.sections.filter(s=>s.visible).forEach(s=>{const row=document.createElement('small');row.textContent=t('themes.section.'+s.id);node.appendChild(row);});preview.appendChild(node);}
        preview.style.setProperty('--preview-accent',checked.colors.accent);status('');
      }catch(error){status(String(error),true);}
    }
    function orderedList(host,values,label,onMove,visibility) {
      host.replaceChildren();values.forEach((value,index)=>{
        const row=document.createElement('div');row.className='theme-order-row';
        const name=document.createElement('span');name.textContent=label(value);row.appendChild(name);
        if(visibility){const input=document.createElement('input');input.type='checkbox';input.checked=value.visible;input.setAttribute('aria-label',t('themes.show',label(value)));input.onchange=()=>{value.visible=input.checked;preview();};row.appendChild(input);}
        for(const [delta,symbol,key]of [[-1,'↑','themes.up'],[1,'↓','themes.down']]){
          const control=button(symbol,()=>{
            onMove(index,index+delta);renderLayout();preview();
            const row=host.children[index+delta];
            [...row.querySelectorAll('button')].find(button=>!button.disabled)?.focus({preventScroll:true});
          });control.disabled=index+delta<0||index+delta>=values.length;control.dataset.edgeDisabled=String(control.disabled);control.setAttribute('aria-label',t(key,label(value)));row.appendChild(control);
        }
        host.appendChild(row);
      });
    }
    function renderLayout() {
      orderedList(get('theme-panel-order'),draft.layout.panels,id=>t('themes.panel.'+id),(from,to)=>{const values=draft.layout.panels;values.splice(to,0,values.splice(from,1)[0]);});
      orderedList(get('theme-section-order'),draft.layout.sections,s=>t('themes.section.'+s.id),(from,to)=>{const values=draft.layout.sections;values.splice(to,0,values.splice(from,1)[0]);},true);
    }
    function edit(theme=null) {
      if(busy||!loaded)return;
      draft=copy(theme||active());
      if(!theme||!theme.id.startsWith('user-')){draft.id=freshId();draft.name=theme?t('themes.copy',theme.name):t('themes.newName');}
      get('theme-name').value=draft.name;get('theme-author').value=draft.author;
      const colors=get('theme-colors');colors.replaceChildren();
      for(const key of Object.keys(COLORS)) {
        const label=document.createElement('label'),caption=document.createElement('span'),input=document.createElement('input');caption.textContent=t('themes.color.'+key);
        input.type='color';input.value=draft.colors[key];input.setAttribute('aria-label',caption.textContent);input.oninput=()=>{draft.colors[key]=input.value;preview();};label.append(caption,input);colors.appendChild(label);
      }
      const sizes=get('theme-sizes');sizes.replaceChildren();
      for(const [key,min,max]of [['libraryWidth',160,420],['detailsWidth',260,800],['coverSize',100,320],['gap',0,48],['radius',0,24]]) {
        const label=document.createElement('label'),text=document.createElement('span'),input=document.createElement('input');text.textContent=t('themes.size.'+key);
        input.type='number';input.min=min;input.max=max;input.step=1;input.value=draft.layout[key];input.setAttribute('aria-label',text.textContent);
        input.oninput=()=>{draft.layout[key]=Number(input.value);preview();};label.append(text,input);sizes.appendChild(label);
      }
      const fields=get('theme-detail-fields');fields.replaceChildren();
      for(const field of FIELDS){const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');input.type='checkbox';input.checked=!draft.layout.hiddenFields.includes(field);text.textContent=t('themes.field.'+field);input.onchange=()=>{draft.layout.hiddenFields=draft.layout.hiddenFields.filter(f=>f!==field);if(!input.checked)draft.layout.hiddenFields.push(field);preview();};label.append(input,text);fields.appendChild(label);}
      renderLayout();get('theme-editor-status').textContent='';ui.openEditor();controls();preview();get('theme-name').focus({preventScroll:true});
    }
    function cancelDraft() {if(draft){draft=null;activate(active());ui?.closeEditor();}}
    return {
      get busy(){return busy;},
      async load() {
        if(loadPromise)return loadPromise;
        loadPromise=(async()=>{try{library=validateLibrary(await invoke('get_theme_library'));activate(active());}
          catch(error){status(t('themes.loadFailed',error),true);console.error(error);}
          finally{loaded=true;renderList();controls();}})();return loadPromise;
      },
      attachPreferences(callbacks) {
        ui=callbacks;
        get('btn-new-theme').onclick=()=>edit();
        get('btn-import-theme').onclick=()=>perform(async()=>{
          const imported=await invoke('import_theme');if(!imported)return;
          const theme=validate({...imported,id:freshId()});await persist({...library,themes:[...library.themes,theme]});status(t('themes.imported',theme.name));
        });
        get('btn-save-theme').onclick=()=>perform(async()=>{
          draft.name=get('theme-name').value;draft.author=get('theme-author').value;
          const theme=validate(draft);await persist({...library,active:theme.id,themes:[...library.themes.filter(t=>t.id!==theme.id),theme]});
          draft=null;ui.closeEditor();status(t('themes.saved',theme.name));
        });
        get('btn-cancel-theme').onclick=()=>{if(!busy)cancelDraft();};
        get('theme-name').oninput=get('theme-author').oninput=preview;
        renderList();controls();
      },
      close(){if(!busy)cancelDraft();},
    };
  }
  globalThis.OpenCabinetThemes={FORMAT,COLORS,SECTIONS,FIELDS,builtins:copy(builtins),validate,validateLibrary,apply,create};
})();
