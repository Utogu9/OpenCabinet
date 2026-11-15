(() => {
  const defaults={bindings:{accept:0,back:1,view:2,turn:3,previousPlatform:4,nextPlatform:5,exit:9,manual:10,openBox:11,zoomOut:6,zoomIn:7},
    navigationDeadZone:.55,rotationDeadZone:.18,rotationSensitivity:1,zoomSensitivity:1,repeatDelay:360,repeatInterval:145};
  const ranges={navigationDeadZone:[.1,.95,.05],rotationDeadZone:[.05,.8,.05],rotationSensitivity:[.2,3,.1],
    zoomSensitivity:[.2,3,.1],repeatDelay:[150,1000,10],repeatInterval:[60,500,5]};
  const t=(key,...args)=>globalThis.OpenCabinetI18n?.t(key,...args)||key;
  function normalize(value={}) {
    value ||= {};const result={bindings:{...defaults.bindings}};
    const incoming=value.bindings;
    if(incoming&&Object.keys(defaults.bindings).every(key=>Number.isInteger(incoming[key])&&incoming[key]>=0&&incoming[key]<=11)
      &&new Set(Object.keys(defaults.bindings).map(key=>incoming[key])).size===Object.keys(defaults.bindings).length)
      result.bindings=Object.fromEntries(Object.keys(defaults.bindings).map(key=>[key,incoming[key]]));
    for(const [key,[min,max]]of Object.entries(ranges))result[key]=Number.isFinite(Number(value[key]))&&Number(value[key])>=min&&Number(value[key])<=max?Number(value[key]):defaults[key];
    return result;
  }
  const buttonNames=['A / Cross','B / Circle','X / Square','Y / Triangle','LB / L1','RB / R1','LT / L2','RT / R2','Back / Select','Start / Options','LS / L3','RS / R3'];
  function createButtonCapture() {
    const held=new Map();
    return {sample(pads=[]) {
      const connected=new Set();
      for(const pad of pads) {
        if(!pad||pad.connected===false||pad.mapping!=='standard')continue;
        const id=`${pad.index}:${pad.id}`;connected.add(id);
        const pressed=new Set(buttonNames.map((_,index)=>index).filter(index=>pad.buttons?.[index]?.pressed||pad.buttons?.[index]?.value>.6));
        const previous=held.get(id);held.set(id,pressed);
        if(previous)for(const button of pressed)if(!previous.has(button))return {button,pad:pad.index};
      }
      for(const id of held.keys())if(!connected.has(id))held.delete(id);
      return null;
    }};
  }
  function hint(settings){return ['accept','back','previousPlatform','nextPlatform','openBox','manual'].map(key=>`${buttonNames[normalize(settings).bindings[key]]}: ${t('controller.'+key)}`).join(' · ');}
  function editor(host,document=globalThis.document) {
    const fields={},buttons={};host.replaceChildren();
    const window=document.defaultView||globalThis.window;
    let bindings={...defaults.bindings},pending=null,timer=null,capture=null;
    const status=document.createElement('p');status.className='preference-help controller-capture-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const pads=()=>{try{return Array.from(window.navigator.getGamepads?.()||[]);}catch{return [];}};
    function renderButtons(){for(const [key,button]of Object.entries(buttons)){
      button.value=String(bindings[key]);button.dataset.button=button.value;
      button.textContent=pending===key?t('controller.pressButton'):buttonNames[bindings[key]];
      button.classList.toggle('listening',pending===key);button.setAttribute('aria-pressed',String(pending===key));
      button.setAttribute('aria-label',t('controller.assign',t('controller.'+key),buttonNames[bindings[key]]));
    }}
    function cancel(message=''){
      window.clearTimeout(timer);timer=null;pending=null;capture=null;
      window.removeEventListener('keydown',keyDown,true);window.removeEventListener('blur',blur);
      renderButtons();status.textContent=message;
    }
    function keyDown(event){if(pending&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel(t('controller.cancelled'));}}
    function blur(){cancel();}
    function poll(){
      if(!pending)return;
      const dialog=host.closest('dialog');
      if(!host.isConnected||host.closest('.hidden')||(dialog&&!dialog.open)){cancel();return;}
      const chosen=capture.sample(pads());
      if(chosen){
        const key=pending,previous=bindings[key];
        for(const other of Object.keys(bindings))if(other!==key&&bindings[other]===chosen.button)bindings[other]=previous;
        bindings[key]=chosen.button;
        cancel(t('controller.assigned',t('controller.'+key),buttonNames[chosen.button]));
      }else timer=window.setTimeout(poll,32);
    }
    function listen(key){
      if(pending===key){cancel(t('controller.cancelled'));return;}
      cancel();pending=key;capture=createButtonCapture();const connected=pads();capture.sample(connected);
      status.textContent=t(connected.some(pad=>pad?.connected!==false&&pad?.mapping==='standard')?'controller.captureHelp':'controller.connect');
      renderButtons();window.addEventListener('keydown',keyDown,true);window.addEventListener('blur',blur);
      timer=window.setTimeout(poll,32);
    }
    const field=(key,input)=>{const group=document.createElement('div');group.className='form-group';const label=document.createElement('label');input.id='controller-'+key;
      label.htmlFor=input.id;label.textContent=t('controller.'+key);group.append(label,input);host.append(group);return input;};
    for(const key of Object.keys(defaults.bindings)){
      const button=document.createElement('button');button.type='button';button.className='browse-btn controller-binding';buttons[key]=field(key,button);
      button.addEventListener('click',()=>listen(key));
    }
    host.append(status);
    for(const [key,[min,max,step]]of Object.entries(ranges)){
      const input=document.createElement('input');input.type='number';input.min=min;input.max=max;input.step=step;fields[key]=field(key,input);
    }
    renderButtons();
    const read=()=>normalize({...Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,Number(input.value)])),bindings});
    return {read,cancel,load(value){cancel();const data=normalize(value);bindings={...data.bindings};for(const [key,input]of Object.entries(fields))input.value=String(data[key]);renderButtons();},
      sync(busy){if(busy)cancel();for(const input of [...Object.values(fields),...Object.values(buttons)])input.disabled=busy;},
      changed(value){return JSON.stringify(read())!==JSON.stringify(normalize(value));}};
  }
  const api={defaults,normalize,editor,hint,createButtonCapture};globalThis.OpenCabinetController=api;
  if(typeof module!=='undefined')module.exports=api;
})();
