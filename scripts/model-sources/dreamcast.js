// Preserved prepared CC0 source geometry. This importer runs only when exporting.
import * as THREE from '../../src/vendor/three/three.module.js';
import { maskClearPanels } from '../../src/three-box-relief.js';

export async function build() {
  const directory=new URL('./dreamcast/',import.meta.url);
  const [manifest,binary]=await Promise.all([
    fetch(new URL('case.json',directory)).then(response=>response.json()),
    fetch(new URL('case.bin',directory)).then(response=>response.arrayBuffer()),
  ]);
  const scene=new THREE.Group(),parts={base:new THREE.Group(),lid:new THREE.Group()},pivot=new THREE.Vector3(...manifest.hinge);
  parts.base.name='Dreamcast base';parts.lid.name='Dreamcast lid';parts.lid.position.copy(pivot);
  scene.add(parts.base,parts.lid);
  const materials=new Map(),meshes=[];
  for(const spec of manifest.meshes) {
    // This source's "hub" is a pale annulus on the disc, not the tray's
    // retaining spindle (which belongs to the acrylic). Printed GD-ROM/CD
    // artwork can continue across this area, down to the 15 mm centre hole.
    if(spec.material==='hub')continue;
    const source=new Float32Array(binary,spec.vertexOffset,spec.vertexCount*8);
    const position=[],normal=[],uv=[];
    for(let i=0;i<source.length;i+=8){position.push(...source.slice(i,i+3));normal.push(...source.slice(i+3,i+6));uv.push(...source.slice(i+6,i+8));}
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(position,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(binary,spec.indexOffset,spec.indexCount).slice(),1));
    if(spec.material==='disc'||spec.material==='discSilver'){
      geometry.computeBoundingBox();
      const center=geometry.boundingBox.getCenter(new THREE.Vector3()),positions=geometry.attributes.position,texture=geometry.attributes.uv;
      let inner=Infinity;
      for(let i=0;i<positions.count;i++)inner=Math.min(inner,Math.hypot(positions.getX(i)-center.x,positions.getY(i)-center.y));
      // Keep the original outer outline and surface topology. Only extend
      // the central rings, including their UVs, instead of stretching the art.
      const transition=19.9,uvScaleX=(.96675843-.03065)/(60.016071*2),uvScaleY=(.969620645-.04371)/(60.016071*2);
      for(let i=0;i<positions.count;i++){
        const x=positions.getX(i),y=positions.getY(i),dx=x-center.x,dy=y-center.y,r=Math.hypot(dx,dy);
        if(r>=transition)continue;
        const radius=7.5+(r-inner)*(transition-7.5)/(transition-inner),scale=radius/r;
        const nextX=center.x+dx*scale,nextY=center.y+dy*scale;
        positions.setXY(i,nextX,nextY);
        if(spec.material==='disc')texture.setXY(i,texture.getX(i)+(nextX-x)*uvScaleX,texture.getY(i)+(nextY-y)*uvScaleY);
      }
      geometry.computeVertexNormals();
    }
    if(spec.part==='lid')geometry.translate(-pivot.x,-pivot.y,-pivot.z);
    geometry.computeBoundingBox();
    if(!materials.has(spec.material))materials.set(spec.material,new THREE.MeshBasicMaterial({name:spec.material}));
    const mesh=new THREE.Mesh(geometry,materials.get(spec.material));mesh.name=spec.name;mesh.userData.dreamcastPart=spec.part;
    parts[spec.part].add(mesh);meshes.push(mesh);
  }
  const spineWindows=['spine_left','spine_right'].map(kind=>meshes.find(mesh=>mesh.material.name===kind).geometry.boundingBox.clone().expandByScalar(1.5));
  for(const mesh of meshes.filter(mesh=>mesh.material.name==='acrylic'))maskClearPanels(mesh.geometry,spineWindows,mesh.parent===parts.lid?pivot:undefined);
  return {scene,parts,manifest,exportData:{hinge:manifest.hinge}};
}
