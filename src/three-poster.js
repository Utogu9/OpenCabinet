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

// Keep full-sized panels the size of the booklet. Only the last panel in each
// direction may be shorter: equal subdivisions would give a different folded
// aspect ratio, while stretching the sheet would distort its artwork.
export function posterLayout(aspect,width,height,columns,rows) {
  const requestedHeight=Math.min(height*rows,width*columns/aspect);
  const fullHeight=Math.min(Math.max(requestedHeight,height,width/aspect),height*8,width*8/aspect);
  const fullWidth=fullHeight*aspect;
  const divide=(total,span)=>{
    const count=Math.max(1,Math.min(8,Math.ceil(total/span-1e-8)));
    return Array.from({length:count},(_,index)=>Math.min(span,total-index*span));
  };
  return {widths:divide(fullWidth,width),heights:divide(fullHeight,height)};
}

// An accordion in each direction. Rows open first, then columns, so a folded
// packet becomes one continuous sheet with a single front and reverse scan.
export function createPosterSheet(width,height,columns,rows,front,back,layout=null,settings={}) {
  const leftward=(settings.corner||'').endsWith('right'),upward=(settings.corner||'').startsWith('bottom');
  const dx=leftward?-1:1,dy=upward?1:-1;
  const widths=layout?.widths||Array(columns).fill(width),heights=layout?.heights||Array(rows).fill(height);
  columns=widths.length;rows=heights.length;
  const offsets=values=>values.reduce((result,value)=>[...result,result.at(-1)+value],[0]);
  const xs=offsets(widths),ys=offsets(heights),fullWidth=xs.at(-1),fullHeight=ys.at(-1);
  const group=new THREE.Group(),meshes=[],rowHinges=[],columnHinges=[],thickness=.06;
  const edge=new THREE.MeshBasicMaterial({color:0xeee9dd}),geometries=[];
  let rowParent=group,frontMesh=null;
  const geometry=(w,h)=>{const g=new THREE.PlaneGeometry(w,h);geometries.push(g);return g;};
  for(let row=0;row<rows;row++){
    const rowHeight=heights[row],rowGroup=new THREE.Group();rowParent.add(rowGroup);if(row)rowGroup.position.y=dy*heights[row-1];
    rowHinges.push(rowGroup);rowParent=rowGroup;let parent=rowGroup;
    for(let column=0;column<columns;column++){
      const columnWidth=widths[column],hinge=new THREE.Group();parent.add(hinge);if(column)hinge.position.x=dx*widths[column-1];
      columnHinges.push({hinge,column});parent=hinge;
      for(const reverse of [false,true]){
        const g=geometry(columnWidth,rowHeight),uv=g.attributes.uv;
        for(let i=0;i<uv.count;i++){
          let u=(xs[column]+(leftward?1-uv.getX(i):uv.getX(i))*columnWidth)/fullWidth;
          let v=(ys[row]+(upward?uv.getY(i):1-uv.getY(i))*rowHeight)/fullHeight;
          if(leftward)u=1-u;if(!upward)v=1-v;
          uv.setXY(i,...posterTextureUV(u,v,settings.rotation,reverse));
        }
        const mesh=new THREE.Mesh(g,reverse?back:front);mesh.position.set(dx*columnWidth/2,dy*rowHeight/2,reverse?-.022:.022);
        hinge.add(mesh);meshes.push(mesh);if(!frontMesh&&!reverse)frontMesh=mesh;
      }
      const bodyGeometry=new THREE.BoxGeometry(columnWidth,rowHeight,.04);bodyGeometry.setDrawRange(0,24);geometries.push(bodyGeometry);
      const body=new THREE.Mesh(bodyGeometry,edge);body.position.set(dx*columnWidth/2,dy*rowHeight/2,0);hinge.add(body);meshes.push(body);
    }
  }
  function pose(amount){
    const early=THREE.MathUtils.clamp(amount*2,0,1),late=THREE.MathUtils.clamp(amount*2-1,0,1);
    const rowOpen=settings.fold_order==='columns_first'?late:early,columnOpen=settings.fold_order==='columns_first'?early:late;
    for(let row=1;row<rows;row++){
      const hinge=rowHinges[row],previous=row-1,base=row+(row%2),old=previous+(previous%2);
      hinge.rotation.x=-dy*(row%2?1:-1)*Math.PI*(1-rowOpen);
      // Stack behind the first printed panel, not above it. Otherwise the
      // outside of an even fold packet becomes the unprinted paper reverse.
      hinge.position.z=-(previous%2?-1:1)*(base-old)*columns*thickness*(1-rowOpen);
    }
    for(const {hinge,column} of columnHinges)if(column){
      hinge.rotation.y=dx*(column%2?1:-1)*Math.PI*(1-columnOpen);
      hinge.position.z=(column%2?-1:1)*thickness*(1-columnOpen);
    }
    group.updateMatrixWorld(true);
  }
  pose(0);
  return {group,meshes,frontMesh,pose,depth:columns*rows*thickness+.05,
    dispose(){geometries.forEach(g=>g.dispose());edge.dispose();group.removeFromParent();}};
}

export function createBoxPoster({getSlot,getSettings,imageSource=value=>value,schedule,allMeshes}) {
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
      const layout=posterLayout(aspect,width,height,requested.columns,requested.rows);
      const columns=layout.widths.length,rows=layout.heights.length;
      sheet=createPosterSheet(width,height,columns,rows,front,back,layout,requested);mount=new THREE.Group();mount.name='Folded Poster';
      mount.position.copy(center).addScaledVector(new THREE.Vector3(0,0,1).applyQuaternion(quaternion),-.06);mount.quaternion.copy(quaternion);
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
    get available(){return !!sheet;},get visible(){return !!mount?.visible;},get meshes(){return sheet?.meshes||[];},get front(){return sheet?.frontMesh;},get root(){return mount;},
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
