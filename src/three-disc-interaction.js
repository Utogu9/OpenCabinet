import * as THREE from './vendor/three/three.module.js';

const t=(key,...args)=>globalThis.OpenCabinetI18n.t(key,...args);
const opticalMaterials=new Set(['UMD Label','Disc Silver','UMD Housing','UMD Window','UMD Disc']);

export function discFinish(profile,game) {
  if(['silver','black','blue','gold'].includes(profile?.discFinish))return profile.discFinish;
  // Sony specifies black PlayStation CDs, blue PS2 CDs and silver PS2 DVDs.
  // File names/compressed image sizes cannot reliably distinguish PS2 CD/DVD.
  const platform=String(game?.platform||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  if(/^(?:sony)?(?:playstation(?:1)?|ps1|psx)$/.test(platform))return 'black';
  return 'silver';
}
export function applyDiscFinish(material,finish) {
  if(!material)return;
  material.color.set(({silver:0xc3cedb,black:0x090909,blue:0x263b9c,gold:0xa48943})[finish]??0xc3cedb);
  material.metalness=finish==='black'?.65:.9;material.roughness=finish==='black'?.23:.19;
  material.envMapIntensity=finish==='black'?.35:1;
  const optics=material.userData.discReverseOptics;
  // Untinted additive diffraction overwhelmed the dark PlayStation substrate.
  // Black discs keep their ordinary specular highlight, without a rainbow glow.
  if(optics){optics.diffraction.value=finish==='black'?0:1;optics.rings.value=finish==='black'?.025:1;}
}

export function discExtractionPosition(origin,targetX,progress,radius) {
  const target=typeof targetX==='number'?new THREE.Vector3(targetX,0,0):targetX;
  const smooth=t=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
  const liftY=Math.max(origin.y,0)+Math.max(24,radius*.9),liftZ=Math.max(origin.z,0)+Math.max(8,radius*.25);
  if(progress<.25){const t=smooth(progress/.25);return new THREE.Vector3(origin.x,THREE.MathUtils.lerp(origin.y,liftY,t),THREE.MathUtils.lerp(origin.z,liftZ,t));}
  if(progress<.7){const t=smooth((progress-.25)/.45);return new THREE.Vector3(THREE.MathUtils.lerp(origin.x,target.x,t),liftY,liftZ);}
  const t=smooth((progress-.7)/.3);return new THREE.Vector3(target.x,THREE.MathUtils.lerp(liftY,target.y,t),THREE.MathUtils.lerp(liftZ,target.z,t));
}

// Focus changes position and size, never the shared camera or the user's
// rotations. The smaller object stays offset behind the selected one to click.
export function discFocusLayout(extent,discDiameter,blend) {
  const boxScale=THREE.MathUtils.lerp(1,.64,blend),discScale=extent*.86/Math.max(discDiameter,.001)*THREE.MathUtils.lerp(.56,1,blend);
  return {boxScale,discScale,
    box:new THREE.Vector3(-extent*.43*blend,extent*.12*blend,-extent*.65*blend),
    disc:new THREE.Vector3(extent*.62*(1-blend),extent*.18*(1-blend),-extent*.5*(1-blend))};
}

// Extracted objects borrow their original meshes' geometry and materials.
// One coordinator owns focus, framing and clipping for the case and both items.
export function createDiscInteraction({host,reference,root,scene,camera,meshes,getGame,isOpen,schedule,discMeshes,
  getDiscs=null,
  getRotationLock=()=> 'free',getManualMeshes=()=>[],getManualFront=()=>null,hasManual=()=>false,
  onManualRemoved=()=>{},readManual=()=>false,getPosterMeshes=()=>[],getPosterFront=()=>null,getPosterRoot=()=>null,hasPoster=()=>false,isPosterVisible=()=>false,
  onPosterRemoved=()=>{},getPosterRevision=()=>0,isPosterUnfolded=()=>false,togglePoster=()=>false,foldPoster=()=>{},getPosters=null,selectPoster=()=>{}}) {
  const make=(kind,type=kind)=>{
    const group=new THREE.Group(),centered=new THREE.Group();group.name='Detached '+kind;
    group.visible=false;group.add(centered);scene.add(group);
    return {kind,type,group,centered,original:new Map(),removed:false,reading:false,amount:0,radius:0,zoom:1,
      bounds:null,transition:null,side:'front',front:new THREE.Quaternion()};
  };
  const disc=make('disc'),manual=make('manual'),poster=make('poster'),entries=[disc,manual,poster];
  const media=discMeshes||meshes.filter(mesh=>opticalMaterials.has(mesh.material?.name));
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let focused='box',picked=null,hitPosterId=null,hitDiscId=null,posterSource=null,discSource=null,weights={box:1,disc:0,manual:0,poster:0},focusTransition=null,tools=null,disposed=false,lastBounds=null;
  let extent=1,boxZoom=1,boxFactor=1,clipOverride=null,sideBySide=false,layoutAmount=0,layoutTransition=null;
  const out=()=>entries.filter(entry=>entry.removed);
  const current=()=>entries.find(entry=>entry.removed&&entry.kind===focused&&!entry.reading);
  const legacyPoster={get available(){return hasPoster();},get meshes(){return getPosterMeshes();},get front(){return getPosterFront();},get root(){return getPosterRoot();},get revision(){return getPosterRevision();},get visible(){return isPosterVisible();},get unfolded(){return isPosterUnfolded();},setRemoved:onPosterRemoved,setUnfolded(value){if(!value)foldPoster();else togglePoster();return true;}};
  const print=entry=>entry?.print||legacyPoster;
  function discs(){
    const descriptions=getDiscs?.()||null;
    if(descriptions!==discSource){
      discSource=descriptions;const old=entries.filter(entry=>entry.type==='disc'),keep=new Set([disc]);
      const list=descriptions?.length?descriptions:[{id:null,meshes:media}];
      list.forEach((item,index)=>{
        let entry=index?old.find(entry=>entry!==disc&&entry.discId===item.id):disc;
        if(!entry){entry=make('disc:'+item.id,'disc');entries.push(entry);weights[entry.kind]=0;}
        entry.discId=item.id;entry.label=item.label;entry.sourceMeshes=item.meshes;keep.add(entry);
      });
      for(const entry of old)if(!keep.has(entry)){restoreEntry(entry);entry.group.removeFromParent();entries.splice(entries.indexOf(entry),1);delete weights[entry.kind];if(focused===entry.kind)focus('box',true);}
    }
    return entries.filter(entry=>entry.type==='disc');
  }
  function chosenDisc(id,removed=false){const list=discs();return id!=null?list.find(entry=>entry.discId===String(id)||entry.kind===id):list.find(entry=>entry.kind===focused&&entry.removed===removed)||list.find(entry=>entry.removed===removed)||list[0];}
  function syncPosters(){
    if(!getPosters)return;
    const descriptions=getPosters();if(descriptions===posterSource)return;posterSource=descriptions;
    const old=entries.filter(entry=>entry.type==='poster'),keep=new Set(),ordered=[];
    descriptions.forEach((item,index)=>{
      const kind=descriptions.length===1?'poster':'poster:'+item.id;
      let entry=old.find(entry=>entry.posterId===item.id);
      if(!entry){entry=old.find(entry=>!entry.posterId&&!keep.has(entry))||make(kind,'poster');if(!entries.includes(entry))entries.push(entry);}
      if(entry.kind!==kind){weights[kind]=weights[entry.kind]||0;delete weights[entry.kind];if(focused===entry.kind)focused=kind;entry.kind=kind;entry.group.name='Detached '+kind;}
      entry.posterId=item.id;entry.label=item.label;entry.print=item.view;keep.add(entry);ordered.push(entry);weights[entry.kind]??=0;
    });
    for(const entry of old)if(!keep.has(entry)){restoreEntry(entry);entry.group.removeFromParent();entries.splice(entries.indexOf(entry),1);delete weights[entry.kind];}
    entries.splice(0,entries.length,...entries.filter(entry=>entry.type!=='poster'),...ordered);
  }
  function posters(){syncPosters();return entries.filter(entry=>entry.type==='poster');}
  const available=entry=>!!entry&&!!getGame()&&(entry.type==='disc'?(entry.sourceMeshes||media).length>0:entry===manual?hasManual()&&getManualMeshes().length>0:print(entry).available&&print(entry).meshes.length>0);
  const sourcesFor=entry=>entry.type==='disc'?entry.sourceMeshes||media:entry===manual?getManualMeshes():print(entry).meshes;
  function chosenPoster(id,removed=false){const list=posters();return id!=null?list.find(entry=>entry.posterId===id||entry.kind===id):list.find(entry=>entry.kind===focused&&entry.removed===removed)||list.find(entry=>removed?entry.removed:print(entry).visible&&!entry.removed);}
  const visible=mesh=>{for(let node=mesh;node;node=node.parent)if(!node.visible)return false;return true;};
  function button(key,action){
    const node=document.createElement('button');node.type='button';node.className='secondary-btn';node.textContent=t(key);
    node.addEventListener('click',event=>{event.stopPropagation();action();});return node;
  }
  function focus(value,immediate=false){
    if(focused!==value||immediate){
      const to=Object.fromEntries(['box',...entries.map(entry=>entry.kind)].map(key=>[key,0]));to[value]=1;
      if(immediate){weights=to;focusTransition=null;}
      else {focusTransition={from:{...weights},to,start:null};host.dataset.discAnimation='moving';}
    }
    focused=value;host.dataset.discFocus=value;
    const selected=entries.find(entry=>entry.kind===value&&entry.type==='poster');if(selected)selectPoster(selected.posterId);
    tools?.querySelectorAll('[data-disc-return]').forEach(node=>{node.hidden=node.dataset.discReturn!==value;});
    tools?.querySelectorAll('[data-poster-unfold]').forEach(node=>{node.hidden=node.dataset.posterUnfold!==value;});
    schedule();
  }
  function refresh(){
    tools?.remove();tools=null;
    if(out().length&&getGame()&&!disposed){
      tools=document.createElement('div');tools.className='game-box-disc-tools';tools.setAttribute('role','toolbar');tools.setAttribute('aria-label',t('disc.controls'));
      tools.addEventListener('pointerdown',event=>event.stopPropagation());tools.addEventListener('keydown',event=>event.stopPropagation());
      const layout=button('disc.sideBySide',()=>api.toggleLayout());layout.setAttribute('aria-pressed',String(sideBySide));tools.append(layout);
      for(const entry of posters().filter(entry=>entry.removed)){const node=button(print(entry).unfolded?'poster.fold':'poster.unfold',()=>api.togglePoster(entry.posterId));node.dataset.posterUnfold=entry.kind;node.hidden=focused!==entry.kind;tools.append(node);}
      for(const entry of out()){
        const node=button(entry.type==='disc'?'disc.putBack':entry===manual?'manual.putBack':'poster.putBack',()=>putBack(entry));
        if(entry.type==='disc'&&discs().length>1)node.textContent=t('disc.namedAction',t('disc.putBack'),entry.label);
        node.dataset.discReturn=entry.kind;node.hidden=focused!==entry.kind;tools.append(node);
      }
      host.appendChild(tools);
    }
    if(discs().some(entry=>entry.removed))host.dataset.discRemoved='true';else delete host.dataset.discRemoved;
    if(manual.removed)host.dataset.manualRemoved='true';else delete host.dataset.manualRemoved;
    if(posters().some(entry=>entry.removed))host.dataset.posterRemoved='true';else delete host.dataset.posterRemoved;
    if(!out().length){delete host.dataset.discFocus;delete host.dataset.discLayout;delete host.dataset.discAnimation;}
    schedule();
  }
  function restoreClipping(){
    if(!clipOverride)return;const {near,far}=clipOverride;clipOverride=null;
    if(camera.near!==near||camera.far!==far){camera.near=near;camera.far=far;camera.updateProjectionMatrix();}
  }
  function restoreEntry(entry){
    for(const [mesh,visible] of entry.original)mesh.visible=visible;
    entry.original.clear();entry.centered.clear();entry.group.visible=false;entry.group.position.set(0,0,0);entry.group.quaternion.identity();entry.group.scale.setScalar(1);
    entry.removed=false;entry.reading=false;entry.amount=0;entry.transition=null;entry.zoom=1;entry.posterMount=null;entry.mountParent=entry.mountInverse=null;
    if(entry===manual)onManualRemoved(false);
    if(entry.type==='poster')print(entry).setRemoved(false);
  }
  function restore(){
    restoreClipping();entries.forEach(restoreEntry);root.position.set(0,0,0);
    focused='box';picked=hitPosterId=null;weights=Object.fromEntries(['box',...entries.map(entry=>entry.kind)].map(key=>[key,key==='box'?1:0]));boxZoom=boxFactor=1;focusTransition=layoutTransition=null;layoutAmount=sideBySide?1:0;
    delete host.dataset.discAnimation;refresh();
  }
  function cast(event,objects){
    const canvas=host.querySelector('canvas');if(!canvas)return null;const rect=canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    reference.updateWorldMatrix(true,true);entries.forEach(entry=>entry.group.updateWorldMatrix(true,true));
    raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(objects,false)[0];
  }
  function anchor(entry){
    reference.updateWorldMatrix(true,true);
    if(entry.type==='poster'&&entry.posterMount&&print(entry).root)return entry.bounds.getCenter(new THREE.Vector3()).applyMatrix4(entry.posterMount.clone().invert()).applyMatrix4(print(entry).root.matrixWorld);
    if(entry.mountParent&&entry.mountInverse){entry.mountParent.updateWorldMatrix(true,false);return entry.bounds.getCenter(new THREE.Vector3()).applyMatrix4(entry.mountInverse).applyMatrix4(entry.mountParent.matrixWorld);}
    return entry.bounds.getCenter(new THREE.Vector3()).applyMatrix4(reference.matrixWorld);
  }
  function returnOrientation(entry){
    const rotation=root.quaternion.clone();if(!entry.mountParent||!entry.mountInverse)return rotation;
    entry.mountParent.updateWorldMatrix(true,false);const transform=reference.matrixWorld.clone().invert().multiply(entry.mountParent.matrixWorld).multiply(entry.mountInverse);
    return rotation.multiply(new THREE.Quaternion().setFromRotationMatrix(transform));
  }
  function remove(entry){
    if(!available(entry)||!isOpen()||entry.removed)return false;
    const alreadyOut=out().length;reference.updateWorldMatrix(true,true);
    const inverse=reference.matrixWorld.clone().invert(),sources=sourcesFor(entry),front=entry.type==='poster'?print(entry).front:entry.type==='disc'?sources.find(mesh=>/Label/.test(mesh.material?.name)):getManualFront();
    if(entry.type==='disc'&&sources[0]?.parent){entry.mountParent=sources[0].parent;entry.mountInverse=inverse.clone().multiply(entry.mountParent.matrixWorld).invert();}
    for(const source of sources){
      const copy=new THREE.Mesh(source.geometry,source.material);copy.matrix.copy(inverse).multiply(source.matrixWorld);copy.matrixAutoUpdate=false;copy.frustumCulled=false;
      entry.centered.add(copy);entry.original.set(source,source.visible);source.visible=false;
      if(entry!==disc&&source===front&&source.geometry.attributes.normal){
        const normal=new THREE.Vector3().fromBufferAttribute(source.geometry.attributes.normal,0).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(copy.matrix));
        entry.front.setFromUnitVectors(normal.normalize(),new THREE.Vector3(0,0,1));
      }
    }
    entry.centered.position.set(0,0,0);entry.group.position.set(0,0,0);entry.group.quaternion.identity();entry.group.scale.setScalar(1);
    entry.group.updateWorldMatrix(true,true);entry.bounds=new THREE.Box3().setFromObject(entry.centered);
    const center=entry.bounds.getCenter(new THREE.Vector3()),point=new THREE.Vector3();entry.radius=0;
    for(const copy of entry.centered.children){const position=copy.geometry.attributes.position;
      for(let i=0;i<position.count;i++)entry.radius=Math.max(entry.radius,point.fromBufferAttribute(position,i).applyMatrix4(copy.matrix).distanceTo(center));}
    entry.centered.position.copy(center.negate());
    entry.origin=anchor(entry);entry.group.position.copy(entry.origin);entry.group.quaternion.copy(root.quaternion);entry.group.scale.copy(root.scale);
    entry.startRotation=root.quaternion.clone();
    const physicalScale=root.scale.clone().multiplyScalar(1/boxFactor);
    extent=Math.max((lastBounds||entry.bounds).getSize(new THREE.Vector3()).multiply(physicalScale).length(),entry.radius*2*Math.max(...physicalScale.toArray()),1);
    entry.group.visible=true;entry.removed=true;entry.amount=0;entry.zoom=1;entry.side='front';entry.reading=false;
    entry.transition={from:0,to:1,start:null};focus(entry.kind,!alreadyOut);
    if(entry===manual)onManualRemoved(true);
    if(entry.type==='poster'){entry.posterRevision=print(entry).revision;entry.posterMount=print(entry).root?inverse.clone().multiply(print(entry).root.matrixWorld):null;print(entry).setRemoved(true);}
    refresh();return true;
  }
  function putBack(entry){
    if(!entry?.removed||entry.transition?.to===0)return false;
    if(entry.type==='poster')print(entry).setUnfolded(false);
    entry.returnTarget=entry.group.position.clone();entry.returnRotation=entry.group.quaternion.clone();entry.returnScale=entry.group.scale.clone();
    entry.transition={from:entry.amount,to:0,start:null};focus('box');refresh();return true;
  }
  function flip(entry,back=null){
    if(!entry?.removed)return false;focus(entry.kind);
    entry.side=back===true?'back':back===false?'front':entry.side==='front'?'back':'front';
    entry.group.quaternion.copy(entry.front);
    if(entry.side==='back')entry.group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI));
    schedule();return true;
  }
  const api={
    get available(){return discs().some(available);},get removed(){return discs().some(entry=>entry.removed);},get focused(){return !!current();},
    get object(){return (chosenDisc(null,true)||disc).group;},get manualObject(){return manual.group;},get manualRemoved(){return manual.removed;},
    get discs(){const list=discs();return list.map(entry=>({id:entry.discId||entry.kind,label:entry.label||t('disc.numbered',list.indexOf(entry)+1),removed:entry.removed,available:available(entry),object:entry.group}));},
    get posterObject(){return (chosenPoster(null,true)||posters()[0]||poster).group;},get posterRemoved(){return posters().some(entry=>entry.removed);},get posterAvailable(){return posters().some(available);},
    get posters(){return posters().map(entry=>({id:entry.posterId||entry.kind,label:entry.label,removed:entry.removed,available:available(entry),visible:print(entry).visible,unfolded:print(entry).unfolded,object:entry.group}));},
    get canRemovePoster(){return isOpen()&&posters().some(entry=>available(entry)&&!entry.removed&&print(entry).visible);},
    get posterUnfolded(){return !!print(chosenPoster(null,true)).unfolded;},
    get manualAvailable(){return available(manual);},
    get pickedManual(){return picked==='manual'&&manual.removed&&!manual.reading&&!manual.transition;},
    hit(event){hitDiscId=null;if(!isOpen())return false;
      const list=discs(),hits=list.filter(entry=>available(entry)&&!entry.removed).map(entry=>({entry,hit:cast(event,sourcesFor(entry).filter(visible))})).filter(item=>item.hit).sort((a,b)=>a.hit.distance-b.hit.distance);
      if(!hits.length)return false;
      if(list.length>1){const obstruction=cast(event,meshes.filter(visible));if(obstruction&&obstruction.distance<hits[0].hit.distance-.05)return false;}
      hitDiscId=hits[0].entry.discId||hits[0].entry.kind;return true;
    },
    hitPoster(event){hitPosterId=null;if(!isOpen())return false;
      const hits=posters().filter(entry=>available(entry)&&!entry.removed&&print(entry).visible).map(entry=>({entry,hit:cast(event,print(entry).meshes)})).filter(item=>item.hit).sort((a,b)=>a.hit.distance-b.hit.distance);
      if(hits.length)hitPosterId=hits[0].entry.posterId||hits[0].entry.kind;return hits.length>0;
    },
    select(event){
      picked=null;
      if(!out().length||tools?.contains(event.target))return false;
      const hits=[];
      for(const entry of out())if(!entry.reading){const hit=cast(event,entry.centered.children);if(hit)hits.push({kind:entry.kind,distance:hit.distance});}
      const box=cast(event,meshes.filter(visible));if(box)hits.push({kind:'box',distance:box.distance});
      hits.sort((a,b)=>a.distance-b.distance);if(hits.length){picked=hits[0].kind;focus(picked);}return api.focused;
    },
    interactionRect(fallback){
      const entry=current();if(!entry)return fallback;
      entry.group.updateWorldMatrix(true,false);camera.updateMatrixWorld(true);
      const canvas=host.querySelector('canvas').getBoundingClientRect(),world=entry.group.getWorldPosition(new THREE.Vector3()),projected=world.clone().project(camera);
      const depth=Math.max(.1,-world.applyMatrix4(camera.matrixWorldInverse).z),scale=Math.max(...entry.group.scale.toArray().map(Math.abs));
      const radius=Math.max(50,entry.radius*scale*Math.abs(camera.projectionMatrix.elements[5])*canvas.height/(2*depth)*1.3),width=radius*2;
      return {left:canvas.left+(projected.x+1)*canvas.width/2-width/2,top:canvas.top+(1-projected.y)*canvas.height/2-width/2,width,height:width};
    },
    remove(id){const entry=chosenDisc(id??hitDiscId);hitDiscId=null;return remove(entry);},putBack:id=>putBack(chosenDisc(id,true)),
    examine(id){const entry=chosenDisc(id,true)||chosenDisc(id);if(!available(entry)||!entry.removed&&!remove(entry))return false;focus(entry.kind);return true;},
    examineBox(){if(!out().length)return false;focus('box');return true;},
    removeManual:()=>remove(manual),returnManual:()=>putBack(manual),
    examineManual(){if(!available(manual)||!manual.removed&&!remove(manual))return false;focus('manual');return true;},
    removePoster(id){const entry=chosenPoster(id??hitPosterId);hitPosterId=null;return !!entry&&print(entry).visible&&remove(entry);},returnPoster:id=>putBack(chosenPoster(id,true)),
    examinePoster(id){const entry=chosenPoster(id,true)||chosenPoster(id);if(!available(entry)||!entry.removed&&!api.removePoster(entry.posterId))return false;focus(entry.kind);return true;},
    togglePoster(id){const entry=chosenPoster(id,true);if(!entry?.removed||entry.transition)return false;const changed=print(entry).setUnfolded(!print(entry).unfolded);refresh();return changed;},
    setManualReading(value){const returning=manual.reading&&!value;manual.reading=!!value;if(manual.removed){manual.group.visible=!value;if(returning)focus('manual');}schedule();},
    resetManual(){if(manual.removed){restoreEntry(manual);focus(discs().find(entry=>entry.removed)?.kind||'box');refresh();}},
    toggleLayout(){if(!out().length||out().some(entry=>entry.transition))return false;sideBySide=!sideBySide;
      layoutTransition={from:layoutAmount,to:sideBySide?1:0,start:null};host.dataset.discAnimation='moving';refresh();return true;},
    rotate(x,y){const entry=current();if(!entry)return false;const lock=getRotationLock();if(lock==='x')y=0;if(lock==='y')x=0;
      entry.group.rotateOnWorldAxis(new THREE.Vector3(0,1,0),x*Math.PI/180);entry.group.rotateOnWorldAxis(new THREE.Vector3(1,0,0),y*Math.PI/180);entry.side=null;schedule();return true;},
    drag(from,to,lock='free'){const entry=current();if(!entry)return false;const math=globalThis.OpenCabinet3D.math;
      const delta=lock==='free'?math.between(from,to):math.axisAngle(lock==='x'?[0,1,0]:[1,0,0],(lock==='x'?to[0]-from[0]:to[1]-from[1])*90);
      entry.group.quaternion.premultiply(new THREE.Quaternion(...delta));entry.side=null;schedule();return true;},
    zoom(delta){if(!out().length)return false;const entry=current();if(entry)entry.zoom=THREE.MathUtils.clamp(entry.zoom+delta,.5,2.5);else boxZoom=THREE.MathUtils.clamp(boxZoom+delta,.65,1.7);schedule();return true;},
    flip(back=null){return flip(current(),back);},
    resetView(){const entry=current();if(!entry)return false;entry.zoom=1;return flip(entry,false);},
    appendMenu(menu,items,closeMenu){
      const actions=[];
      if(out().length)actions.push(['box.examine',api.examineBox]);
      const optical=discs();for(const entry of optical)if(available(entry)&&(entry.removed||isOpen())){
        const label=optical.length>1?entry.label:null;
        actions.push(...(entry.removed?[['disc.examine',()=>api.examine(entry.discId),label],['disc.putBack',()=>api.putBack(entry.discId),label]]:[['disc.remove',()=>api.remove(entry.discId),label],['disc.examine',()=>api.examine(entry.discId),label]]));
      }
      if(available(manual)&&(manual.removed||isOpen()))actions.push(...(manual.removed?[['manual.examine',api.examineManual],['manual.putBack',api.returnManual]]:[['manual.remove',api.removeManual]]),['manual.read',readManual]);
      const sheets=posters();
      for(const entry of sheets){const label=sheets.length>1?entry.label:null;
        if(entry.removed)actions.push(['poster.examine',()=>api.examinePoster(entry.posterId),label],[print(entry).unfolded?'poster.fold':'poster.unfold',()=>api.togglePoster(entry.posterId),label],['poster.putBack',()=>api.returnPoster(entry.posterId),label]);
        else if(available(entry)&&isOpen()&&print(entry).visible)actions.push(['poster.remove',()=>api.removePoster(entry.posterId),label]);
      }
      if(!actions.length)return;menu.appendChild(document.createElement('hr'));
      for(const [key,action,label] of actions){const node=button(key,()=>{closeMenu();action();});if(label)node.textContent=t('poster.namedAction',t(key),label);node.className='dropdown-item';node.setAttribute('role','menuitem');menu.appendChild(node);items.push(node);}
    },
    beforeFrame(){discs();syncPosters();restoreClipping();root.position.set(0,0,0);},
    layout(time,bounds){
      lastBounds=bounds;if(!out().length||!bounds)return;
      if(focusTransition){
        focusTransition.start??=time;const t=Math.min(1,(time-focusTransition.start)/320),ease=t*t*(3-2*t);
        for(const key of Object.keys(weights))weights[key]=THREE.MathUtils.lerp(focusTransition.from[key]||0,focusTransition.to[key]||0,ease);
        if(t===1)focusTransition=null;else schedule();
      }
      if(layoutTransition){layoutTransition.start??=time;const t=Math.min(1,(time-layoutTransition.start)/320);
        layoutAmount=THREE.MathUtils.lerp(layoutTransition.from,layoutTransition.to,t*t*(3-2*t));if(t===1)layoutTransition=null;else schedule();}
      for(const entry of out())if(entry.transition){
        entry.transition.start??=time;const t=Math.min(1,(time-entry.transition.start)/760);entry.amount=THREE.MathUtils.lerp(entry.transition.from,entry.transition.to,t);
        if(t===1&&entry.transition.to===0){restoreEntry(entry);refresh();}
        else if(t===1){if(entry!==disc)entry.group.quaternion.copy(entry.front);entry.transition=null;}else schedule();
      }
      for(const poster of posters())if(poster.removed&&poster.posterRevision!==print(poster).revision){
        reference.updateWorldMatrix(true,true);const mount=print(poster).root;mount?.updateWorldMatrix(true,true);
        const inverse=poster.posterMount&&mount?poster.posterMount.clone().multiply(mount.matrixWorld.clone().invert()):reference.matrixWorld.clone().invert(),sources=print(poster).meshes,bounds=new THREE.Box3(),point=new THREE.Vector3();
        for(let i=0;i<sources.length;i++){const source=sources[i],copy=poster.centered.children[i];if(!copy)continue;
          source.updateWorldMatrix(true,false);copy.matrix.copy(inverse).multiply(source.matrixWorld);copy.geometry.computeBoundingBox();bounds.union(copy.geometry.boundingBox.clone().applyMatrix4(copy.matrix));}
        poster.bounds=bounds;const center=bounds.getCenter(new THREE.Vector3());poster.radius=0;
        for(const copy of poster.centered.children){const p=copy.geometry.attributes.position;for(let i=0;i<p.count;i++)poster.radius=Math.max(poster.radius,point.fromBufferAttribute(p,i).applyMatrix4(copy.matrix).distanceTo(center));}
        poster.centered.position.copy(center.negate());poster.posterRevision=print(poster).revision;
      }
      const detached=out();if(!detached.length){boxFactor=1;return;}
      const amount=Math.max(...detached.map(entry=>entry.amount)),ease=amount*amount*(3-2*amount),baseScale=root.scale.clone(),baseSize=bounds.getSize(new THREE.Vector3()).multiply(baseScale);
      const scale=Math.max(...baseScale.toArray().map(Math.abs)),boxBlend=1-weights.box;
      const boxPlacement=new THREE.Vector3(-extent*.43*boxBlend,extent*.12*boxBlend,-extent*.65*boxBlend);
      const diameters=detached.map(entry=>entry.radius*2*scale),gap=Math.max(12,Math.min(baseSize.x,...diameters)*.18);
      const sideWidth=baseSize.x+diameters.reduce((a,b)=>a+b,0)+gap*detached.length;
      boxPlacement.lerp(new THREE.Vector3(-sideWidth/2+baseSize.x/2,0,0),layoutAmount);
      boxFactor=THREE.MathUtils.lerp(1,THREE.MathUtils.lerp(1-.36*boxBlend,1,layoutAmount)*boxZoom,ease);
      root.position.copy(boxPlacement).multiplyScalar(ease);root.scale.copy(baseScale).multiplyScalar(boxFactor);reference.updateWorldMatrix(true,true);
      let sideCursor=-sideWidth/2+baseSize.x+gap;
      const frames=[{radius:bounds.getSize(new THREE.Vector3()).multiply(baseScale).length()/2*boxFactor,position:root.position}];
      let posterIndex=0,discIndex=0;
      for(const entry of detached){
        const offset=entry.type==='poster'?posterIndex++:entry.type==='disc'?discIndex++:0,blend=weights[entry.kind]||0,radius=entry.radius*scale,direction=entry===manual?-1:1;
        const target=new THREE.Vector3(direction*extent*(.62+offset*.15)*(1-blend),extent*(entry.type==='disc'?.18+offset*.12:entry===manual?-.15:-.30-offset*.12)*(1-blend),-extent*(.5+offset*.12)*(1-blend));
        target.lerp(new THREE.Vector3(sideCursor+radius,0,0),layoutAmount);sideCursor+=radius*2+gap;
        const factor=THREE.MathUtils.lerp(extent*.86/Math.max(radius*2,.001)*THREE.MathUtils.lerp(.56,1,blend),1,layoutAmount)*entry.zoom;
        const e=entry.amount*entry.amount*(3-2*entry.amount),returning=entry.transition?.to===0;
        entry.group.position.copy(discExtractionPosition(returning?anchor(entry):entry.origin,returning?entry.returnTarget:target,entry.amount,radius));
        if(returning){entry.group.quaternion.copy(returnOrientation(entry)).slerp(entry.returnRotation,entry.amount);entry.group.scale.copy(root.scale).lerp(entry.returnScale,e);}
        else {
          entry.group.scale.copy(baseScale).multiplyScalar(THREE.MathUtils.lerp(boxFactor,factor,e));
          if(entry.transition&&entry!==disc)entry.group.quaternion.copy(entry.startRotation).slerp(entry.front,e);
        }
        frames.push({radius:entry.radius*Math.max(...entry.group.scale.toArray().map(Math.abs)),position:entry.group.position});
      }
      const tangent=Math.tan(camera.fov*Math.PI/360);
      const fit=THREE.MathUtils.lerp(extent*.59,Math.max(extent*.59,sideWidth*.6),layoutAmount)/(tangent*Math.min(1,camera.aspect));
      camera.position.z=THREE.MathUtils.lerp(camera.position.z,fit,ease);
      let minZ=Infinity,maxZ=-Infinity;
      for(const frame of frames){minZ=Math.min(minZ,frame.position.z-frame.radius);maxZ=Math.max(maxZ,frame.position.z+frame.radius);}
      clipOverride??={near:camera.near,far:camera.far};camera.near=Math.max(.05,(camera.position.z-maxZ)*.25);camera.far=Math.max(camera.near+10,camera.position.z-minZ+25);camera.updateProjectionMatrix();
      host.dataset.discAnimation=detached.some(entry=>entry.transition)||focusTransition||layoutTransition?'moving':'ready';host.dataset.discFocus=focused;host.dataset.discLayout=sideBySide?'side-by-side':'foreground';
    },
    reset(){restore();},dispose(){disposed=true;restore();entries.forEach(entry=>entry.group.removeFromParent());}
  };
  return api;
}
