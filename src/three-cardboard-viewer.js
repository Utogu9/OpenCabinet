import { createModelViewer } from './three-gltf-box-viewer.js';
import { loadPreparedModel } from './three-prepared-model.js';
import * as THREE from './vendor/three/three.module.js';

// All cardboard profiles share a baked unit cuboid. Only UVs and dimensions
// adapt to the selected cover; no case geometry is generated at runtime.
async function load() {
  const {scene,manifest}=await loadPreparedModel('cardboard');
  const mesh=scene.getObjectByName('Cardboard Box'),sheen=scene.getObjectByName('Printed Cardboard Finish');
  const geometry=mesh.geometry,sourceUV=geometry.attributes.uv.clone(),uv=geometry.attributes.uv;
  const loader=new THREE.MaterialLoader(),materials=new Map(manifest.cardboardMaterials.map(info=>[info.name,loader.parse(info)]));
  const edge=materials.get('Cardboard Edges'),cover=materials.get('Cover Outside');
  mesh.material.dispose();sheen.material.dispose();sheen.material=materials.get('Cardboard Finish');
  mesh.material=[edge,cover,edge,edge,cover,cover];
  geometry.clearGroups();for(let i=0;i<6;i++)geometry.addGroup(i*6,6,i);
  let base=null,current=null,game=null,settings=null,axis='x',uvKey=null;
  function layout(profile,wrapAxis) {
    const key=[profile.width,profile.height,profile.depth,profile.spineFace,wrapAxis].join(':');
    if(key===uvKey)return;uvKey=key;
    const top=profile.spineFace==='top',panel=wrapAxis==='x'?profile.width:profile.height;
    const total=panel*2+profile.depth,face=panel/total,spine=profile.depth/total;
    // Face order in BoxGeometry: right, left, top, bottom, front, back.
    mesh.material=[edge,top?edge:cover,top?cover:edge,edge,cover,cover];
    manifest.spine_fraction=spine;
    for(let i=0;i<uv.count;i++){
      const side=Math.floor(i/4),isSpine=side===(top?2:1),front=side===4;
      let u=sourceUV.getX(i),v=1-sourceUV.getY(i);
      if(isSpine&&top)[u,v]=[v,1-u];
      if(wrapAxis==='x')uv.setXY(i,(isSpine?face+u*spine:front?face+spine+u*face:u*face),v);
      else if(isSpine)uv.setXY(i,1-v,face+u*spine);
      else uv.setXY(i,u,front?face+spine+v*face:v*face);
    }
    uv.needsUpdate=true;
  }
  function update(profile,next,resolved) {
    base=current=profile;game=next;settings=resolved;axis='x';
    edge.color.set(profile.color);layout(profile,axis);
  }
  function prepareArtwork(pictures) {
    if(!base)return;
    const image=pictures.full||pictures.cover;
    let ratio=null;
    axis=pictures.full&&(image.naturalWidth||image.width)<(image.naturalHeight||image.height)?'y':'x';
    if(image){
      ratio=(image.naturalWidth||image.width)/(image.naturalHeight||image.height);
      if(pictures.full)ratio=axis==='x'?Math.max(.1,(ratio-base.depth/base.height)/2)
        :2/Math.max(.1,1/ratio-base.depth/base.width);
    }
    const next=globalThis.OpenCabinet3D.profileFor(game.platform,ratio,game.rom_path,settings);
    const changed=next.id!==current.id||next.width!==current.width||next.height!==current.height||next.depth!==current.depth||next.spineFace!==current.spineFace;
    current=next;layout(next,axis);
    return changed?next:undefined;
  }
  return {scene,manifest,animations:[],update,prepareArtwork};
}

export function createViewer(host,options={}) {
  return createModelViewer(host,options,{model:'cardboard',canOpen:false,load});
}
