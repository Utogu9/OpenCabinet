import { GLTFLoader } from './vendor/three/GLTFLoader.js';

// Parse each bundled model once, including in couch mode. Every viewer owns
// clones of its buffers/materials, so changing UVs or retiring a GPU context
// cannot invalidate another case. The cached template never reaches the GPU.
const sources=new Map();
export async function loadPreparedModel(model) {
  if(!sources.has(model))sources.set(model,fetch(new URL(`./models/${model}/case.glb`,import.meta.url))
    .then(response=>{if(!response.ok)throw Error(`${model} model is unavailable`);return response.arrayBuffer();})
    .then(bytes=>new GLTFLoader().parseAsync(bytes,''))
    .catch(error=>{sources.delete(model);throw error;}));
  const template=await sources.get(model);
  const gltf={scene:template.scene.clone(true),animations:template.animations.map(clip=>clip.clone())};
  const geometries=new Map(),materials=new Map();
  gltf.scene.traverse(mesh=>{
    if(!mesh.isMesh)return;
    if(!geometries.has(mesh.geometry))geometries.set(mesh.geometry,mesh.geometry.clone());
    mesh.geometry=geometries.get(mesh.geometry);
    const copy=material=>{if(!materials.has(material))materials.set(material,material.clone());return materials.get(material);};
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(copy):copy(mesh.material);
  });
  let modelRoot;gltf.scene.traverse(node=>{if(node.userData.opencabinetModel)modelRoot=node;});
  const manifest=modelRoot?.userData.opencabinetModel;
  if(manifest?.version!==1||manifest.model!==model)throw Error(`Unsupported prepared ${model} model`);
  if(modelRoot!==gltf.scene){modelRoot.removeFromParent();gltf.scene=modelRoot;}
  if(manifest.sourceUnits==='millimeters'){modelRoot.scale.multiplyScalar(1000);modelRoot.updateMatrix();}
  // GLTFLoader sanitizes names for animation bindings. Preserve human-readable
  // source names without losing the targets of the baked opening tracks.
  const targets=new Map();gltf.scene.traverse(node=>{targets.set(node.name,node.uuid);});
  for(const clip of gltf.animations)for(const track of clip.tracks) {
    const dot=track.name.lastIndexOf('.'),target=targets.get(track.name.slice(0,dot));
    if(target)track.name=target+track.name.slice(dot);
  }
  gltf.scene.traverse(node=>{
    if(node.userData.originalName)node.name=node.userData.originalName;
    if(node.isMesh){
      node.castShadow=!!node.userData.castsShadow;
      node.receiveShadow=!!node.userData.receivesShadow;
      for(const name of node.userData.attributeNames||[]) {
        if(node.geometry.hasAttribute(name))continue;
        const encoded='_'+name.toLowerCase(),attribute=node.geometry.getAttribute(encoded);
        if(attribute){node.geometry.setAttribute(name,attribute);node.geometry.deleteAttribute(encoded);}
      }
    }
  });
  return {...gltf,manifest};
}
