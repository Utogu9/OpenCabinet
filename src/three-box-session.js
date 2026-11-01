// Keep recently used couch contexts resident, leaving room for desktop viewers
// below the browser's usual 16-context limit. CPU scenes survive retirement.
const leases=new Set();
const contextLimit=12;
let usage=0;
export function prepareRenderGroup(group,reserve=1) {
  if(!group?.active)return;
  let excess=[...leases].filter(lease=>lease.resident).length+reserve-contextLimit;
  for(const lease of [...leases].filter(lease=>lease.group&&lease.group!==group&&lease.resident)
    .sort((a,b)=>a.lastUsed-b.lastUsed)) {
    if(excess--<=0)break;
    lease.suspend(true);
  }
}
// A cold context must upload its textures and rebuild GPU-only lighting. Keep
// the last complete frame above it until the restored scene has actually drawn.
export function createFrameHold(renderer,host,draw) {
  const canvas=renderer.domElement;
  let frozen=null;
  return {
    capture(){
      if(frozen)return;
      const image=canvas.ownerDocument.createElement('canvas');
      image.width=canvas.width;image.height=canvas.height;
      try {
        draw();image.getContext('2d').drawImage(canvas,0,0);
      }catch{image.width=image.height=0;return;}
      image.style.cssText=canvas.style.cssText;image.style.pointerEvents='none';
      image.setAttribute('aria-hidden','true');image.dataset.frozenFrame='true';
      host.append(image);frozen=image;canvas.style.visibility='hidden';
    },
    release(){if(frozen){frozen.remove();frozen.width=frozen.height=0;frozen=null;canvas.style.visibility='';}},
  };
}
// dispose() releases GPU handles, not the CPU attributes, materials or images.
// Remove old-context disposal listeners before Three.js restores its caches.
export function releaseSceneGpu(scene) {
  const geometries=new Set(),materials=new Set(),textures=new Set();
  scene.traverse(node=>{
    if(node.geometry)geometries.add(node.geometry);
    for(const material of (Array.isArray(node.material)?node.material:[node.material]))if(material)materials.add(material);
    if(node.skeleton?.boneTexture)textures.add(node.skeleton.boneTexture);
  });
  for(const material of materials)for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
  geometries.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());textures.forEach(value=>value.dispose());
}
export function createRenderLease(renderer,group,onReady,onLost=()=>{},onRetire=()=>{}) {
  const canvas=renderer.domElement;
  let paused=false,released=false,acknowledged=false,externalLoss=false,restoring=false,requested=false,disposed=false,timer=null;
  function restore() {
    if(timer!==null||paused||disposed||restoring||!released||!acknowledged)return;
    timer=setTimeout(()=>{
      timer=null;if(!paused&&!disposed&&released&&acknowledged){restoring=true;renderer.forceContextRestore();}
    },0);
  }
  const lost=event=>{event.preventDefault();acknowledged=true;externalLoss=true;onLost();restore();};
  const restored=()=>{
    released=false;externalLoss=false;acknowledged=false;restoring=false;requested=false;
    if(paused||group?.active===false)api.suspend(true);else onReady(true);
  };
  canvas.addEventListener('webglcontextlost',lost);
  canvas.addEventListener('webglcontextrestored',restored);
  const api={group,
    lastUsed:++usage,
    get resident(){return requested||(!released&&!externalLoss);},
    get paused(){return paused;},get lost(){return released||externalLoss;},
    suspend(release=false){
      if(disposed)return;paused=true;
      if(timer!==null){clearTimeout(timer);timer=null;}
      if(release){requested=false;if(!released){
        if(!externalLoss)onRetire();
        released=true;if(!externalLoss){acknowledged=false;renderer.forceContextLoss();}
      }}
    },
    resume(){
      if(disposed||group?.active===false)return;
      prepareRenderGroup(group,api.resident?0:1);requested=api.lost;api.lastUsed=++usage;paused=false;
      if(api.lost)restore();else onReady(false);
    },
    dispose(){disposed=true;if(timer!==null)clearTimeout(timer);leases.delete(api);
      canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored);},
  };
  leases.add(api);
  if(group?.active===false)api.suspend(true);
  return api;
}
