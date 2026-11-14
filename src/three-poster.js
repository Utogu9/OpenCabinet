import * as THREE from './vendor/three/three.module.js';
import './poster-settings.js';

export function posterGrid(profile={}) {
  const valid=value=>Number.isInteger(value)&&value>=1&&value<=8;
  return {columns:valid(profile.posterColumns)?profile.posterColumns:2,rows:valid(profile.posterRows)?profile.posterRows:2};
}

export function posterTextureUV(u,v,rotation=0,reverse=false) {
  if(rotation===90)[u,v]=[1-v,u];
  else if(rotation===180)[u,v]=[1-u,1-v];
  else if(rotation===270)[u,v]=[v,1-u];
  return [reverse?1-u:u,v];
}

// Preserve the requested number of panels. The booklet supplies the maximum
// folded footprint, never an automatically substituted row/column count.
export function posterLayout(aspect,width,height,columns,rows,foldOrder='rows_first') {
  const fullHeight=Math.min(height*rows,width*columns/aspect);
  const fullWidth=fullHeight*aspect;
  const rowWrap=foldOrder==='rows_first'?rows>1:columns===1;
  const columnWrap=foldOrder==='columns_first'?columns>1:rows===1;
  const divide=(total,span,count,wrap)=>{
    if(count===1)return [total];
    // A wrap needs two full outside panels, not one large face plus a shorter
    // white flap. Smaller intermediate panels tuck inside those two faces.
    const outside=wrap?2:1;
    if(count>outside&&total>outside*span+1e-7)return [...Array(outside).fill(span),...Array(count-outside).fill((total-outside*span)/(count-outside))];
    return Array(count).fill(total/count);
  };
  return {widths:divide(fullWidth,width,columns,columnWrap),heights:divide(fullHeight,height,rows,rowWrap)};
}

// Nested wrap folds, not an accordion: the remaining panels tuck between the
// first two panels. Both outside faces therefore belong to the printed front.
export function createPosterSheet(width,height,columns,rows,front,back,layout=null,settings={}) {
  const leftward=(settings.corner||'').endsWith('right'),upward=(settings.corner||'').startsWith('bottom');
  const dx=leftward?-1:1,dy=upward?1:-1;
  const widths=layout?.widths||Array(columns).fill(width),heights=layout?.heights||Array(rows).fill(height);
  columns=widths.length;rows=heights.length;
  const offsets=values=>values.reduce((result,value)=>[...result,result.at(-1)+value],[0]);
  const xs=offsets(widths),ys=offsets(heights),fullWidth=xs.at(-1),fullHeight=ys.at(-1);
  const group=new THREE.Group(),meshes=[],outerHinges=[],innerHinges=[],thickness=.06,cells=Array.from({length:rows},()=>[]);
  const edge=new THREE.MeshBasicMaterial({color:0xeee9dd}),geometries=[];
  const outerRows=settings.fold_order!=='columns_first',outerCount=outerRows?rows:columns,innerCount=outerRows?columns:rows;
  const outerSizes=outerRows?heights:widths,innerSizes=outerRows?widths:heights;
  const outerAxis=outerRows?'x':'y',innerAxis=outerRows?'y':'x';
  const outerDirection=outerRows?dy:dx,innerDirection=outerRows?dx:dy;
  const outerAngle=outerRows?-dy:dx,innerAngle=outerRows?dx:-dy;
  let outerParent=group,frontMesh=null;
  const geometry=(w,h)=>{const g=new THREE.PlaneGeometry(w,h);geometries.push(g);return g;};
  for(let outer=0;outer<outerCount;outer++){
    const outerGroup=new THREE.Group();outerParent.add(outerGroup);if(outer)outerGroup.position[outerRows?'y':'x']=outerDirection*outerSizes[outer-1];
    outerHinges.push({hinge:outerGroup,index:outer});outerParent=outerGroup;let parent=outerGroup;
    for(let inner=0;inner<innerCount;inner++){
      const row=outerRows?outer:inner,column=outerRows?inner:outer,rowHeight=heights[row],columnWidth=widths[column];
      const hinge=new THREE.Group();parent.add(hinge);if(inner)hinge.position[outerRows?'x':'y']=innerDirection*innerSizes[inner-1];
      innerHinges.push({hinge,index:inner});parent=hinge;const cell=[];
      for(const reverse of [false,true]){
        const g=geometry(columnWidth,rowHeight),uv=g.attributes.uv;
        for(let i=0;i<uv.count;i++){
          let u=(xs[column]+(leftward?1-uv.getX(i):uv.getX(i))*columnWidth)/fullWidth;
          let v=(ys[row]+(upward?uv.getY(i):1-uv.getY(i))*rowHeight)/fullHeight;
          if(leftward)u=1-u;if(!upward)v=1-v;
          uv.setXY(i,...posterTextureUV(u,v,settings.rotation,reverse));
        }
        const mesh=new THREE.Mesh(g,reverse?back:front);mesh.position.set(dx*columnWidth/2,dy*rowHeight/2,reverse?-.022:.022);
        hinge.add(mesh);cell.push(mesh);if(!frontMesh&&!reverse)frontMesh=mesh;
      }
      const bodyGeometry=new THREE.BoxGeometry(columnWidth,rowHeight,.04);bodyGeometry.setDrawRange(0,24);geometries.push(bodyGeometry);
      const body=new THREE.Mesh(bodyGeometry,edge);body.position.set(dx*columnWidth/2,dy*rowHeight/2,0);hinge.add(body);cell.push(body);cells[row][column]=cell;
    }
  }
  meshes.push(...cells.flat(2));
  function pose(amount){
    const early=THREE.MathUtils.clamp(amount*2,0,1),late=THREE.MathUtils.clamp(amount*2-1,0,1);
    const outerOpen=innerCount===1?amount:early,innerOpen=outerCount===1?amount:late;
    const progress=(value,index,count)=>THREE.MathUtils.clamp(value*(count-1)-(index-1),0,1);
    // Open the enclosing fold before its tucked-in children. Closing reverses
    // that order, folding the inner flap before the outer one wraps around it.
    for(const {hinge,index} of outerHinges)if(index){
      const open=progress(outerOpen,index,outerCount);
      hinge.rotation[outerAxis]=outerAngle*Math.PI*(1-open);
      hinge.position.z=-((outerCount-index+1)*innerCount-1)*thickness*(1-open);
    }
    for(const {hinge,index} of innerHinges)if(index){
      const open=progress(innerOpen,index,innerCount);
      hinge.rotation[innerAxis]=innerAngle*Math.PI*(1-open);
      hinge.position.z=-(innerCount-index)*thickness*(1-open);
    }
    group.updateMatrixWorld(true);
  }
  pose(0);
  return {group,meshes,frontMesh,pose,depth:columns*rows*thickness+.05,
    dispose(){geometries.forEach(g=>g.dispose());edge.dispose();group.removeFromParent();}};
}

function createSinglePoster({getSlot,getSettings,getLayerOffset=()=>0,imageSource=value=>value,schedule,allMeshes}) {
  let paths=null,controller=null,loading=null,sheet=null,mount=null,removed=false,opened=false,covered=true;
  let amount=0,unfolded=false,animation=null,revision=0,disposed=false;
  const textures=[],materials=[];
  const front=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.FrontSide,toneMapped:false});
  const back=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.BackSide,toneMapped:false});materials.push(front,back);
  async function image(path,signal){
    if(!path)return null;
    return new Promise((resolve,reject)=>{
      const node=new Image();node.crossOrigin='anonymous';node.decoding='async';node.fetchPriority='low';
      const abort=()=>{node.src='';reject(new DOMException('Aborted','AbortError'));};
      const clean=()=>signal.removeEventListener('abort',abort);
      node.onload=()=>{clean();if(signal.aborted){abort();return;}
        const scale=Math.min(1,2048/Math.max(node.naturalWidth,node.naturalHeight)),canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(node.naturalWidth*scale));canvas.height=Math.max(1,Math.round(node.naturalHeight*scale));
        canvas.getContext('2d').drawImage(node,0,0,canvas.width,canvas.height);resolve(canvas);};
      node.onerror=()=>{clean();reject(Error('Poster image unavailable'));};
      if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});node.src=imageSource(path);
    });
  }
  function clear(){
    controller?.abort();controller=null;loading=null;
    if(sheet){for(const mesh of sheet.meshes){const index=allMeshes.indexOf(mesh);if(index>=0)allMeshes.splice(index,1);}sheet.dispose();}
    mount?.removeFromParent();mount=sheet=null;textures.splice(0).forEach(texture=>texture.dispose());
    front.map=back.map=null;front.needsUpdate=back.needsUpdate=true;paths=null;removed=false;amount=0;unfolded=false;animation=null;revision++;
  }
  async function ensure(){
    if(disposed||sheet||loading||!paths||!getSlot())return;
    const signal=controller.signal,current=controller,selected=paths;
    loading=(async()=>{
      const results=await Promise.allSettled([image(selected.front,signal),image(selected.back,signal)]);
      if(disposed||signal.aborted||controller!==current)return;
      const pictures=results.map(result=>result.status==='fulfilled'?result.value:null),source=pictures[0]||pictures[1];
      if(!source){paths=null;return;}
      const slot=getSlot();if(!slot)return;
      slot.front.updateWorldMatrix(true,false);slot.parent.updateWorldMatrix(true,false);slot.front.geometry.computeBoundingBox();
      const bounds=slot.front.geometry.boundingBox,size=bounds.getSize(new THREE.Vector3());
      const matrix=slot.parent.matrixWorld.clone().invert().multiply(slot.front.matrixWorld),position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();
      matrix.decompose(position,quaternion,scale);
      const center=bounds.getCenter(new THREE.Vector3()).applyMatrix4(matrix);
      const normal=new THREE.Vector3().fromBufferAttribute(slot.front.geometry.attributes.normal,0).normalize();
      quaternion.multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),normal));
      const requested=globalThis.OpenCabinetPosters.settings(getSettings()),width=size.x*Math.abs(scale.x)*.985,height=size.y*Math.abs(scale.y)*.985;
      const aspect=requested.rotation%180?source.height/source.width:source.width/source.height;
      const layout=posterLayout(aspect,width,height,requested.columns,requested.rows,requested.fold_order);
      const columns=layout.widths.length,rows=layout.heights.length;
      sheet=createPosterSheet(width,height,columns,rows,front,back,layout,requested);mount=new THREE.Group();mount.name='Folded Poster';
      mount.position.copy(center).addScaledVector(new THREE.Vector3(0,0,1).applyQuaternion(quaternion),-.06-getLayerOffset());mount.quaternion.copy(quaternion);
      sheet.group.position.set((requested.corner.endsWith('right')?1:-1)*layout.widths[0]/2,(requested.corner.startsWith('bottom')?-1:1)*layout.heights[0]/2,0);mount.add(sheet.group);slot.parent.add(mount);allMeshes.push(...sheet.meshes);
      for(let i=0;i<pictures.length;i++)if(pictures[i]){
        // A very soft crease remains visible after the sheet lies flat. This
        // changes only the in-memory print, never the user's original scan.
        const canvas=pictures[i],context=canvas.getContext('2d'),band=Math.max(1,Math.max(canvas.width,canvas.height)*.002);
        const crease=(p,vertical)=>{
          const gradient=vertical?context.createLinearGradient(p-band,0,p+band,0):context.createLinearGradient(0,p-band,0,p+band);
          gradient.addColorStop(0,'#0000');gradient.addColorStop(.42,'#00000014');gradient.addColorStop(.58,'#ffffff12');gradient.addColorStop(1,'#fff0');context.fillStyle=gradient;
          if(vertical)context.fillRect(p-band,0,band*2,canvas.height);else context.fillRect(0,p-band,canvas.width,band*2);
        };
        const totalWidth=layout.widths.reduce((a,b)=>a+b,0),totalHeight=layout.heights.reduce((a,b)=>a+b,0);
        const line=(u,v,vertical)=>{
          const [x,y]=posterTextureUV(u,v,requested.rotation,(i===1)!==(requested.first_side==='back')),turned=requested.rotation%180!==0;
          const canvasVertical=vertical!==turned;crease(canvasVertical?canvas.width*x:canvas.height*(1-y),canvasVertical);
        };
        let x=0,y=0;
        for(let column=0;column<columns-1;column++){x+=layout.widths[column];line(requested.corner.endsWith('right')?1-x/totalWidth:x/totalWidth,.5,true);}
        for(let row=0;row<rows-1;row++){y+=layout.heights[row];line(.5,requested.corner.startsWith('bottom')?y/totalHeight:1-y/totalHeight,false);}
        const texture=new THREE.CanvasTexture(pictures[i]);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;textures.push(texture);
        const material=(i===0)!==(requested.first_side==='back')?front:back;material.map=texture;material.needsUpdate=true;
      }
      revision++;mount.visible=opened&&!covered&&!removed;schedule();
    })().catch(error=>{if(!signal.aborted)console.warn('Poster preview:',error);}).finally(()=>{if(controller===current)loading=null;});
    return loading;
  }
  return {
    update(images){clear();const first=kind=>images.find(image=>image.kind===kind)?.path;
      const a=first('poster_front')||first('poster'),b=first('poster_back');if(a||b){paths={front:a,back:b};controller=new AbortController();}},
    ensure,
    foldForBounds(){if(!sheet||!removed)return ()=>{};sheet.pose(0);return ()=>sheet.pose(amount);},
    get available(){return !!sheet;},get visible(){return !!mount?.visible;},get meshes(){return sheet?.meshes||[];},get front(){return sheet?.frontMesh;},get root(){return mount;},get removed(){return removed;},
    get depth(){const value=globalThis.OpenCabinetPosters.settings(getSettings());return sheet?.depth??value.columns*value.rows*.06+.05;},
    get revision(){return revision;},get unfolded(){return unfolded;},
    get animating(){return !!animation;},
    setRemoved(value){removed=value;if(mount)mount.visible=opened&&!covered&&!removed;schedule();},
    setUnfolded(value){if(!sheet||(!removed&&value))return false;unfolded=!!value;animation={from:amount,to:value?1:0,start:null};schedule();return true;},
    frame(time,isOpen,isCovered){
      opened=isOpen;covered=isCovered;
      if(opened&&!sheet)void ensure();
      if(mount)mount.visible=opened&&!covered&&!removed;
      if(animation&&sheet){animation.start??=time;const t=Math.min(1,(time-animation.start)/620);amount=THREE.MathUtils.lerp(animation.from,animation.to,t*t*(3-2*t));
        sheet.pose(amount);revision++;if(t===1)animation=null;else schedule();}
    },
    clear,dispose(){disposed=true;clear();materials.forEach(material=>material.dispose());},
  };
}

// Each packet owns its print, folds and extraction state; only the common case
// slot and render loop are shared. Closed cases never decode poster scans.
export function createBoxPoster(options){
  let items=[],selected=null;
  const active=()=>items.find(item=>item.id===selected)?.view||items[0]?.view;
  function clear(){items.forEach(item=>item.view.dispose());items=[];selected=null;}
  return {
    update(images){clear();
      const pairs=globalThis.OpenCabinetPosters.collection(options.getSettings(),images);
      pairs.forEach((pair,index)=>{
        const view=createSinglePoster({...options,getSettings:()=>({poster:pair.settings}),getLayerOffset:()=>items.slice(0,index).reduce((sum,item)=>sum+item.view.depth+.12,0)});
        view.update(['front','back'].filter(side=>pair[side]).map(side=>({kind:'poster_'+side,path:pair[side]})));
        items.push({id:pair.id,label:pair.name||globalThis.OpenCabinetI18n.t('poster.numbered',index+1),view});
      });selected=items[0]?.id||null;
    },
    get entries(){return items;},select(id){if(items.some(item=>item.id===id))selected=id;},
    ensure(){return Promise.all(items.map(item=>item.view.ensure()));},
    frame(...args){items.forEach(item=>item.view.frame(...args));},
    foldForBounds(){const restore=items.map(item=>item.view.foldForBounds());return ()=>restore.forEach(fn=>fn());},
    get available(){return items.some(item=>item.view.available);},get visible(){return items.some(item=>item.view.visible);},
    get meshes(){return active()?.meshes||[];},get front(){return active()?.front;},get root(){return active()?.root;},
    get revision(){return active()?.revision||0;},get unfolded(){return !!active()?.unfolded;},get animating(){return items.some(item=>item.view.animating);},
    setRemoved(value){active()?.setRemoved(value);},setUnfolded(value){return active()?.setUnfolded(value)??false;},
    clear,dispose:clear,
  };
}
