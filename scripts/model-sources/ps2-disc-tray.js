// Original optional PS2 swing tray, authored from the user's case photographs.
// This module runs only in the offline GLB exporter, never at app startup.
import * as THREE from '../../src/vendor/three/three.module.js';
import {mergeGeometries,mergeVertices} from '../../src/vendor/three/BufferGeometryUtils.js';

export function build(){
  const scene=new THREE.Group(),plastic=new THREE.MeshPhysicalMaterial({name:'Case Plastic',color:0x343537,roughness:.84,metalness:0,specularIntensity:.16}),parts=[];
  const spineX=-66.6,hingeProjection=4;
  // Keep the closed disc centred in the case while leaving its entire radius
  // beyond the hinge. The spine motion supplies the offset when the case opens.
  const centerX=-spineX-hingeProjection,centerY=-18.05,radius=62.5,left=0;
  function add(geometry,x=0,y=0,z=0){geometry.translate(x,y,z);if(geometry.index){const plain=geometry.toNonIndexed();geometry.dispose();geometry=plain;}parts.push(geometry);}
  // Solid D-shaped backing: the straight hinge side joins the round dish
  // across its full height. There are no windows or a drilled centre hole.
  const shape=new THREE.Shape();shape.moveTo(left,centerY-radius);shape.lineTo(centerX,centerY-radius);
  shape.absarc(centerX,centerY,radius,-Math.PI/2,Math.PI/2,false);shape.lineTo(left,centerY+radius);
  shape.closePath();
  const plate=new THREE.ExtrudeGeometry(shape,{depth:.6,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.22,bevelThickness:.12,curveSegments:64});add(plate,0,0,-.6);
  // The hinge rail is backed by the continuous plate, not two open arms.
  add(new THREE.BoxGeometry(3.1,119,1.3),1.8,centerY,-.15);
  for(const sign of [-1,1]){
    const pin=new THREE.CylinderGeometry(1.45,1.45,6.4,24);add(pin,.1,centerY+sign*55.7,-.1);
    add(new THREE.BoxGeometry(4.7,3,2.8),1.2,centerY+sign*51.3,-.1);
  }
  // Raised retaining arcs with three real finger recesses, as on the photos.
  for(const [start,end]of [[.25,1.16],[1.72,2.83],[3.40,4.27],[4.92,6.03]]){
    const arc=new THREE.Shape();arc.absarc(centerX,centerY,62.3,start,end,false);arc.absarc(centerX,centerY,60.4,end,start,true);arc.closePath();
    add(new THREE.ExtrudeGeometry(arc,{depth:2.0,bevelEnabled:true,bevelSegments:2,bevelSize:.25,bevelThickness:.2,steps:1,curveSegments:16}),0,0,.05);
  }
  const ring=new THREE.TorusGeometry(8.2,.7,8,64);add(ring,centerX,centerY,.8);
  const hub=new THREE.CylinderGeometry(3.7,4.6,2.8,48);hub.rotateX(Math.PI/2);add(hub,centerX,centerY,1.25);
  for(let i=0;i<6;i++){const tooth=new THREE.BoxGeometry(1.7,4.1,1.1);tooth.translate(0,5.7,0);tooth.rotateZ(i*Math.PI/3);add(tooth,centerX,centerY,2.25);}
  const merged=mergeGeometries(parts),geometry=mergeVertices(merged,1e-5);merged.dispose();parts.forEach(g=>g.dispose());
  const mesh=new THREE.Mesh(geometry,plastic);mesh.name='PS2 Swing Tray';mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);
  parts.length=0;
  for(const sign of [-1,1]){
    const clip=new THREE.Shape();clip.absarc(0,0,2.2,Math.PI*.25,Math.PI*1.75,false);clip.absarc(0,0,1.6,Math.PI*1.75,Math.PI*.25,true);clip.closePath();
    const shell=new THREE.ExtrudeGeometry(clip,{depth:2.8,bevelEnabled:true,bevelSegments:1,bevelSize:.1,bevelThickness:.1,steps:1,curveSegments:16});shell.rotateX(Math.PI/2);add(shell,.1,centerY+sign*55.7+1.4,-.1);
    // Fixed supports grow out of the middle of the spine, projecting to the
    // case rim. They do not attach to the fold bordering the original disc.
    add(new THREE.BoxGeometry(hingeProjection-1.5,3.4,1.2),-(hingeProjection+1.5)/2,centerY+sign*55.7,-1.25);
    add(new THREE.BoxGeometry(.8,7,5),-hingeProjection+.4,centerY+sign*55.7,0);
  }
  const mountGeometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());
  const mounts=new THREE.Mesh(mountGeometry,plastic);mounts.name='PS2 Tray Snap Mounts';mounts.userData.trayPart='mount';mounts.castShadow=mounts.receiveShadow=true;scene.add(mounts);
  return {scene,manifest:{dimensions:[130,127,5]},exportData:{discCenter:[centerX,centerY,1.25],spineMount:[spineX,0,0],hingeOffset:[hingeProjection,0,0]}};
}
