// Reversing printed paper never changes the original image, booklet or plastic.
// Pairs retain their own UVs: swapping the scans must not mirror printed text.
export function createReversibleCover({host,getGame,getPairs,available,schedule,onChange=()=>{}}) {
  let reversed=false,animation=null,swapped=false,saved=[],saving=false,generation=0,temporary=[];
  function restore() {
    if(!swapped)return;
    for(const [material,map,color] of saved){material.map=map;material.color.copy(color);material.needsUpdate=true;}
    saved=[];swapped=false;temporary.forEach(texture=>texture.dispose());temporary=[];
  }
  function refresh() {
    restore();
    if(!reversed||!available())return;
    for(const [outside,inside,mirrorUV=false] of getPairs()) {
      if(!outside||!inside?.map)continue;
      const a=[outside,outside.map,outside.color.clone()],b=[inside,inside.map,inside.color.clone()];
      const map=source=>{if(!source||!mirrorUV)return source;const clone=source.clone();clone.offset.x+=clone.repeat.x;clone.repeat.x*=-1;clone.needsUpdate=true;temporary.push(clone);return clone;};
      saved.push(a,b);outside.map=map(b[1]);outside.color.copy(b[2]);inside.map=map(a[1]);inside.color.copy(a[2]);
      outside.needsUpdate=inside.needsUpdate=true;
    }
    swapped=true;
  }
  const affected=()=>[...new Set(getPairs().flatMap(pair=>pair.slice(0,2)).filter(Boolean))];
  let fading=[];
  function unfade(){for(const [material,opacity,transparent,depthWrite] of fading){Object.assign(material,{opacity,transparent,depthWrite});material.needsUpdate=true;}fading=[];}
  function reset(value=false){generation++;restore();unfade();animation=null;saving=false;reversed=!!value;delete host.dataset.coverTurning;host.dataset.coverReversed=String(reversed);}
  async function toggle() {
    if(!available()||animation||saving)return false;
    const next=!reversed,game=getGame(),token=generation;saving=true;
    try {
      await (onChange?.(game,next)??globalThis.OpenCabinetCoverPreferences?.save?.(game,next));
      if(token!==generation)return false;
      const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if(reduced){reversed=next;refresh();host.dataset.coverReversed=String(reversed);schedule();return true;}
      fading=affected().map(material=>[material,material.opacity,material.transparent,material.depthWrite]);
      for(const [material]of fading){material.transparent=true;material.depthWrite=false;material.needsUpdate=true;}
      animation={start:null,next,changed:false};host.dataset.coverTurning='true';schedule();return true;
    }catch(error){globalThis.OpenCabinetCoverPreferences?.error?.(error);return false;}
    finally{if(token===generation)saving=false;}
  }
  function frame(time) {
    if(!animation)return;
    animation.start??=time;const progress=Math.min(1,(time-animation.start)/420);
    if(progress>=.5&&!animation.changed){reversed=animation.next;animation.changed=true;refresh();host.dataset.coverReversed=String(reversed);}
    const opacity=Math.abs(2*progress-1);for(const [material,original]of fading)material.opacity=original*opacity;
    if(progress===1){unfade();animation=null;delete host.dataset.coverTurning;}else schedule();
  }
  function appendMenu(menu,items,close) {
    if(!available())return;
    const button=document.createElement('button');button.type='button';button.className='dropdown-item';
    button.textContent=globalThis.OpenCabinetI18n.t(reversed?'cover.restore':'cover.reverse');button.setAttribute('role','menuitem');button.disabled=!!animation||saving;
    button.addEventListener('click',()=>{close();void toggle();});menu.appendChild(button);items?.push(button);
  }
  return {get reversed(){return reversed;},get available(){return !!available();},get turning(){return !!animation;},restore,refresh,frame,reset,toggle,appendMenu};
}
