// Cached couch scenes keep their CPU models and textures. Only one platform
// group keeps GPU contexts hot, avoiding the browser's live-context limit.
const leases=new Set();
export function prepareRenderGroup(group) {
  if(!group?.active)return;
  for(const lease of leases)if(lease.group&&lease.group!==group)lease.suspend(true);
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
export function createRenderLease(renderer,group,onReady,onLost=()=>{}) {
  const canvas=renderer.domElement;
  let paused=false,released=false,acknowledged=false,externalLoss=false,restoring=false,disposed=false,timer=null;
  function restore() {
    if(timer!==null||paused||disposed||restoring||!released||!acknowledged)return;
    timer=setTimeout(()=>{
      timer=null;if(!paused&&!disposed&&released&&acknowledged){restoring=true;renderer.forceContextRestore();}
    },0);
  }
  const lost=event=>{event.preventDefault();acknowledged=true;externalLoss=true;onLost();restore();};
  const restored=()=>{
    released=false;externalLoss=false;acknowledged=false;restoring=false;
    if(paused||group?.active===false)api.suspend(true);else onReady(true);
  };
  canvas.addEventListener('webglcontextlost',lost);
  canvas.addEventListener('webglcontextrestored',restored);
  const api={group,
    get paused(){return paused;},get lost(){return released||externalLoss;},
    suspend(release=false){
      if(disposed)return;paused=true;
      if(timer!==null){clearTimeout(timer);timer=null;}
      if(release&&!released){released=true;if(!externalLoss){acknowledged=false;renderer.forceContextLoss();}}
    },
    resume(){
      if(disposed||group?.active===false)return;
      prepareRenderGroup(group);paused=false;
      if(api.lost)restore();else onReady(false);
    },
    dispose(){disposed=true;if(timer!==null)clearTimeout(timer);leases.delete(api);
      canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored);},
  };
  leases.add(api);
  if(group?.active===false)api.suspend(true);
  return api;
}
