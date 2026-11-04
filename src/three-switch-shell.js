// The authored open case has its inner paper-facing floor at Y = 1.5 mm.
// Separate real triangle groups instead of mixing opaque and refractive pixels
// in one transparent material. Vertex order, skin weights and morphs stay intact.
export function splitSwitchShell(geometry) {
  const position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),originalIndex=geometry.getIndex();
  const opaque=[],inside=[],count=originalIndex?.count||position.count;
  for(let i=0;i<count;i+=3){
    const triangle=[0,1,2].map(offset=>originalIndex?originalIndex.getX(i+offset):i+offset);
    const floor=triangle.every(index=>normal.getY(index)>.85&&position.getY(index)>.001&&position.getY(index)<.0019);
    (floor?inside:opaque).push(...triangle);
  }
  return {originalIndex,originalGroups:geometry.groups.map(group=>({...group})),indices:[...opaque,...inside],opaqueCount:opaque.length,insideCount:inside.length};
}

export function createSwitchShells(THREE,meshes) {
  const outer=new THREE.MeshPhysicalMaterial({name:'Switch 2 Shell',color:0xa40000,roughness:.42,metalness:0,
    toneMapped:false,specularIntensity:.015,envMapIntensity:.08,clearcoat:0,clearcoatRoughness:.4,
    side:THREE.FrontSide,transparent:false,depthWrite:true,transmission:0});
  const inner=new THREE.MeshPhysicalMaterial({name:'Switch 2 Inner Sheet',color:0xa40000,roughness:.4,metalness:0,
    toneMapped:false,specularIntensity:.015,envMapIntensity:.08,
    // Reduce the former 88% transparency by 30%: 88% * 0.7 = 61.6%.
    side:THREE.FrontSide,transparent:true,opacity:.384,depthWrite:false,transmission:0});
  const entries=meshes.filter(mesh=>['PP','PP Cloudy'].includes(mesh.material?.name)).map(mesh=>{
    const split=splitSwitchShell(mesh.geometry);
    return {mesh,material:mesh.material,...split,index:new THREE.BufferAttribute(new Uint32Array(split.indices),1)};
  });
  let active=false;
  return {outer,inner,
    set(enabled,color){
      outer.color.set(color||0xa40000);inner.color.set(color||0xa40000);
      if(active===enabled)return;active=enabled;
      for(const entry of entries){
        const geometry=entry.mesh.geometry;geometry.clearGroups();
        if(enabled){
          geometry.setIndex(entry.index);entry.mesh.material=[outer,inner];
          if(entry.opaqueCount)geometry.addGroup(0,entry.opaqueCount,0);
          if(entry.insideCount)geometry.addGroup(entry.opaqueCount,entry.insideCount,1);
        }else{
          geometry.setIndex(entry.originalIndex);entry.mesh.material=entry.material;
          for(const group of entry.originalGroups)geometry.addGroup(group.start,group.count,group.materialIndex);
        }
      }
    },
    dispose(){outer.dispose();inner.dispose();},
  };
}
