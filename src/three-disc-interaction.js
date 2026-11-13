import * as THREE from './vendor/three/three.module.js';

const t=(key,...args)=>globalThis.OpenCabinetI18n.t(key,...args);
const opticalMaterials=new Set(['UMD Label','Disc Silver','UMD Housing','UMD Window','UMD Disc']);

export function discFinish(profile,game) {
  if(['silver','black','blue','gold'].includes(profile?.discFinish))return profile.discFinish;
  return 'silver';
}
export function applyDiscFinish(material,finish) {
  if(!material)return;
  material.color.set(({silver:0xc3cedb,black:0x171022,blue:0x263b9c,gold:0xa48943})[finish]??0xc3cedb);
  material.metalness=finish==='black'?.65:.9;material.roughness=finish==='black'?.23:.19;
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
  getRotationLock=()=> 'free',getManualMeshes=()=>[],getManualFront=()=>null,hasManual=()=>false,
  onManualRemoved=()=>{},readManual=()=>false}) {
  const make=kind=>{
    const group=new THREE.Group(),centered=new THREE.Group();group.name=kind==='disc'?'Detached Disc':'Detached Manual';
    group.visible=false;group.add(centered);scene.add(group);
    return {kind,group,centered,original:new Map(),removed:false,reading:false,amount:0,radius:0,zoom:1,
      bounds:null,transition:null,side:'front',front:new THREE.Quaternion()};
  };
  const disc=make('disc'),manual=make('manual'),entries=[disc,manual];
  const media=discMeshes||meshes.filter(mesh=>opticalMaterials.has(mesh.material?.name));
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let focused='box',weights={box:1,disc:0,manual:0},focusTransition=null,tools=null,disposed=false,lastBounds=null;
  let extent=1,boxZoom=1,boxFactor=1,clipOverride=null,sideBySide=false,layoutAmount=0,layoutTransition=null;
  const out=()=>entries.filter(entry=>entry.removed);
  const current=()=>entries.find(entry=>entry.removed&&entry.kind===focused&&!entry.reading);
  const available=entry=>!!getGame()&&(entry===disc?media.length>0:hasManual()&&getManualMeshes().length>0);
  function button(key,action){
    const node=document.createElement('button');node.type='button';node.className='secondary-btn';node.textContent=t(key);
    node.addEventListener('click',event=>{event.stopPropagation();action();});return node;
  }
  function focus(value,immediate=false){
    if(focused!==value||immediate){
      const to={box:0,disc:0,manual:0};to[value]=1;
      if(immediate){weights=to;focusTransition=null;}
      else {focusTransition={from:{...weights},to,start:null};host.dataset.discAnimation='moving';}
    }
    focused=value;host.dataset.discFocus=value;
    tools?.querySelectorAll('[data-disc-return]').forEach(node=>{node.hidden=node.dataset.discReturn!==value;});
    schedule();
  }
  function refresh(){
    tools?.remove();tools=null;
    if(out().length&&getGame()&&!disposed){
      tools=document.createElement('div');tools.className='game-box-disc-tools';tools.setAttribute('role','toolbar');tools.setAttribute('aria-label',t('disc.controls'));
      tools.addEventListener('pointerdown',event=>event.stopPropagation());tools.addEventListener('keydown',event=>event.stopPropagation());
      const layout=button('disc.sideBySide',()=>api.toggleLayout());layout.setAttribute('aria-pressed',String(sideBySide));tools.append(layout);
      for(const entry of out()){
        const node=button(entry===disc?'disc.putBack':'manual.putBack',()=>putBack(entry));
        node.dataset.discReturn=entry.kind;node.hidden=focused!==entry.kind;tools.append(node);
      }
      host.appendChild(tools);
    }
    if(disc.removed)host.dataset.discRemoved='true';else delete host.dataset.discRemoved;
    if(manual.removed)host.dataset.manualRemoved='true';else delete host.dataset.manualRemoved;
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
    entry.removed=false;entry.reading=false;entry.amount=0;entry.transition=null;entry.zoom=1;
    if(entry===manual)onManualRemoved(false);
  }
  function restore(){
    restoreClipping();entries.forEach(restoreEntry);root.position.set(0,0,0);
    focused='box';weights={box:1,disc:0,manual:0};boxZoom=boxFactor=1;focusTransition=layoutTransition=null;layoutAmount=sideBySide?1:0;
    delete host.dataset.discAnimation;refresh();
  }
  function cast(event,objects){
    const canvas=host.querySelector('canvas');if(!canvas)return null;const rect=canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    reference.updateWorldMatrix(true,true);entries.forEach(entry=>entry.group.updateWorldMatrix(true,true));
    raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(objects,false)[0];
  }
  function anchor(entry){
    reference.updateWorldMatrix(true,true);return entry.bounds.getCenter(new THREE.Vector3()).applyMatrix4(reference.matrixWorld);
  }
  function remove(entry){
    if(!available(entry)||!isOpen()||entry.removed)return false;
    const alreadyOut=out().length;reference.updateWorldMatrix(true,true);
    const inverse=reference.matrixWorld.clone().invert(),sources=entry===disc?media:getManualMeshes(),front=getManualFront();
    for(const source of sources){
      const copy=new THREE.Mesh(source.geometry,source.material);copy.matrix.copy(inverse).multiply(source.matrixWorld);copy.matrixAutoUpdate=false;copy.frustumCulled=false;
      entry.centered.add(copy);entry.original.set(source,source.visible);source.visible=false;
      if(entry===manual&&source===front&&source.geometry.attributes.normal){
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
    refresh();return true;
  }
  function putBack(entry){
    if(!entry.removed||entry.transition?.to===0)return false;
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
    get available(){return available(disc);},get removed(){return disc.removed;},get focused(){return !!current();},
    get object(){return disc.group;},get manualObject(){return manual.group;},get manualRemoved(){return manual.removed;},
    get manualAvailable(){return available(manual);},
    hit(event){return available(disc)&&!disc.removed&&isOpen()&&!!cast(event,media);},
    select(event){
      if(!out().length||tools?.contains(event.target))return false;
      const hits=[];
      for(const entry of out())if(!entry.reading){const hit=cast(event,entry.centered.children);if(hit)hits.push({kind:entry.kind,distance:hit.distance});}
      const box=cast(event,meshes.filter(mesh=>mesh.visible));if(box)hits.push({kind:'box',distance:box.distance});
      hits.sort((a,b)=>a.distance-b.distance);if(hits.length)focus(hits[0].kind);return api.focused;
    },
    interactionRect(fallback){
      const entry=current();if(!entry)return fallback;
      entry.group.updateWorldMatrix(true,false);camera.updateMatrixWorld(true);
      const canvas=host.querySelector('canvas').getBoundingClientRect(),world=entry.group.getWorldPosition(new THREE.Vector3()),projected=world.clone().project(camera);
      const depth=Math.max(.1,-world.applyMatrix4(camera.matrixWorldInverse).z),scale=Math.max(...entry.group.scale.toArray().map(Math.abs));
      const radius=Math.max(50,entry.radius*scale*Math.abs(camera.projectionMatrix.elements[5])*canvas.height/(2*depth)*1.3),width=radius*2;
      return {left:canvas.left+(projected.x+1)*canvas.width/2-width/2,top:canvas.top+(1-projected.y)*canvas.height/2-width/2,width,height:width};
    },
    remove:()=>remove(disc),putBack:()=>putBack(disc),
    examine(){if(!available(disc)||!disc.removed&&!remove(disc))return false;focus('disc');return true;},
    examineBox(){if(!out().length)return false;focus('box');return true;},
    removeManual:()=>remove(manual),returnManual:()=>putBack(manual),
    examineManual(){if(!available(manual)||!manual.removed&&!remove(manual))return false;focus('manual');return true;},
    setManualReading(value){const returning=manual.reading&&!value;manual.reading=!!value;if(manual.removed){manual.group.visible=!value;if(returning)focus('manual');}schedule();},
    resetManual(){if(manual.removed){restoreEntry(manual);focus(disc.removed?'disc':'box');refresh();}},
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
      if(available(disc)&&(disc.removed||isOpen()))actions.push(...(disc.removed?[['disc.examine',api.examine],['disc.putBack',api.putBack]]:[['disc.remove',api.remove],['disc.examine',api.examine]]));
      if(available(manual)&&(manual.removed||isOpen()))actions.push(...(manual.removed?[['manual.examine',api.examineManual],['manual.putBack',api.returnManual]]:[['manual.remove',api.removeManual]]),['manual.read',readManual]);
      if(!actions.length)return;menu.appendChild(document.createElement('hr'));
      for(const [key,action] of actions){const node=button(key,()=>{closeMenu();action();});node.className='dropdown-item';node.setAttribute('role','menuitem');menu.appendChild(node);items.push(node);}
    },
    beforeFrame(){restoreClipping();root.position.set(0,0,0);},
    layout(time,bounds){
      lastBounds=bounds;if(!out().length||!bounds)return;
      if(focusTransition){
        focusTransition.start??=time;const t=Math.min(1,(time-focusTransition.start)/320),ease=t*t*(3-2*t);
        for(const key of ['box','disc','manual'])weights[key]=THREE.MathUtils.lerp(focusTransition.from[key],focusTransition.to[key],ease);
        if(t===1)focusTransition=null;else schedule();
      }
      if(layoutTransition){layoutTransition.start??=time;const t=Math.min(1,(time-layoutTransition.start)/320);
        layoutAmount=THREE.MathUtils.lerp(layoutTransition.from,layoutTransition.to,t*t*(3-2*t));if(t===1)layoutTransition=null;else schedule();}
      for(const entry of out())if(entry.transition){
        entry.transition.start??=time;const t=Math.min(1,(time-entry.transition.start)/760);entry.amount=THREE.MathUtils.lerp(entry.transition.from,entry.transition.to,t);
        if(t===1&&entry.transition.to===0){restoreEntry(entry);refresh();}
        else if(t===1){if(entry===manual)entry.group.quaternion.copy(entry.front);entry.transition=null;}else schedule();
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
      for(const entry of detached){
        const blend=weights[entry.kind],radius=entry.radius*scale,direction=entry===disc?1:-1;
        const target=new THREE.Vector3(direction*extent*.62*(1-blend),extent*(entry===disc?.18:-.15)*(1-blend),-extent*.5*(1-blend));
        target.lerp(new THREE.Vector3(sideCursor+radius,0,0),layoutAmount);sideCursor+=radius*2+gap;
        const factor=THREE.MathUtils.lerp(extent*.86/Math.max(radius*2,.001)*THREE.MathUtils.lerp(.56,1,blend),1,layoutAmount)*entry.zoom;
        const e=entry.amount*entry.amount*(3-2*entry.amount),returning=entry.transition?.to===0;
        entry.group.position.copy(discExtractionPosition(returning?anchor(entry):entry.origin,returning?entry.returnTarget:target,entry.amount,radius));
        if(returning){entry.group.quaternion.copy(root.quaternion).slerp(entry.returnRotation,entry.amount);entry.group.scale.copy(root.scale).lerp(entry.returnScale,e);}
        else {
          entry.group.scale.copy(baseScale).multiplyScalar(THREE.MathUtils.lerp(boxFactor,factor,e));
          if(entry.transition&&entry===manual)entry.group.quaternion.copy(entry.startRotation).slerp(entry.front,e);
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
