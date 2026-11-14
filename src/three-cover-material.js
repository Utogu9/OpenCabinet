import * as THREE from './vendor/three/three.module.js';

// R = height, G = roughness, A = specular intensity. This is data, never color
// or opacity. In particular, do not round-trip it through a 2D canvas: canvas
// premultiplication destroys R/G where A is zero.
export async function loadCoverMaterial(path,{imageSource=value=>value,signal,flipY=false}={}){
  const response=await fetch(imageSource(path),{signal});if(!response.ok)throw Error('Cover material unavailable');
  const blob=await response.blob();
  let bitmap=await createImageBitmap(blob,{premultiplyAlpha:'none',colorSpaceConversion:'none',imageOrientation:flipY?'flipY':'none'});
  try{
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(Math.max(bitmap.width,bitmap.height)>2048){
      const scale=2048/Math.max(bitmap.width,bitmap.height),smaller=await createImageBitmap(bitmap,{premultiplyAlpha:'none',colorSpaceConversion:'none',resizeWidth:Math.max(1,Math.round(bitmap.width*scale)),resizeHeight:Math.max(1,Math.round(bitmap.height*scale)),resizeQuality:'high'});
      bitmap.close();bitmap=smaller;
    }
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');return bitmap;
  }catch(error){bitmap.close();throw error;}
}

export function configureCoverFinish(material,{separateSpines=0,frontMask=null}={}){
  material.onBeforeCompile=shader=>{
    // Tall jewel atlases duplicate their spine into one additional UV strip.
    shader.vertexShader=`vec2 coverFinishUV(vec2 uv){
      float f=${Number(separateSpines).toFixed(8)};
      if(f>0.0){float u=uv.x*(1.0+f);uv.x=u>1.0?(1.0-f)*0.5+u-1.0:u;}
      return uv;
    }\n`+shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
      #ifdef USE_BUMPMAP
        vBumpMapUv=coverFinishUV(vBumpMapUv);
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv=coverFinishUV(vRoughnessMapUv);
      #endif
      #ifdef USE_SPECULAR_INTENSITYMAP
        vSpecularIntensityMapUv=coverFinishUV(vSpecularIntensityMapUv);
      #endif
    `);
    const mask=frontMask?`step(${frontMask[0].toFixed(8)},vMapUv.x)*step(vMapUv.x,${frontMask[1].toFixed(8)})`:'0.0';
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      float coverManualMask=${mask};
      if(coverManualMask>0.5){normal=nonPerturbedNormal;roughnessFactor=1.0;}
    `).replace('#include <opaque_fragment>',`
      // Preserve the scan's unlit color. Only small relief shading and the
      // physical reflections are added; diffuse lighting must not bleach it.
      float coverReliefShade=0.0;
      #if NUM_DIR_LIGHTS > 0
        coverReliefShade=clamp(dot(normal,directionalLights[0].direction)-dot(nonPerturbedNormal,directionalLights[0].direction),-0.35,0.35);
      #endif
      outgoingLight=diffuseColor.rgb*(1.0+coverReliefShade*0.35)+totalSpecular*(1.0-coverManualMask);
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey=()=>JSON.stringify(['cover-finish-v1',separateSpines,frontMask]);
}

// The ordinary paper material remains the source of artwork and UV transforms.
// Only games that provide a valid packed map use the physical replacement.
export function createCoverFinish({meshes,surfaces,filmMeshes=()=>[],environment=()=>null,imageSource,flipY=false,schedule}){
  let controller=null,bitmap=null,packed=null,revision=0;
  const prints=new Map(),hidden=new Map();
  function swap(from,to){for(const mesh of meshes){if(Array.isArray(mesh.material))mesh.material=mesh.material.map(value=>value===from?to:value);else if(mesh.material===from)mesh.material=to;}}
  function restoreFilms(){for(const[mesh,visible]of hidden)mesh.visible=visible;hidden.clear();}
  function clear(){revision++;controller?.abort();controller=null;
    for(const[base,value]of prints){swap(value.material,base);value.texture.dispose();value.material.dispose();}prints.clear();
    restoreFilms();packed?.dispose();packed=null;bitmap?.close();bitmap=null;
  }
  function refresh(){
    let active=false;
    for(const spec of surfaces()){
      const base=spec.material;let record=prints.get(base);
      if(!packed||!base.map||!spec.enabled){if(record){swap(record.material,base);record.active=false;}continue;}
      if(!record){
        const texture=packed.clone(),material=new THREE.MeshPhysicalMaterial({name:base.name+' Material',roughness:1,metalness:0,specularIntensity:1,bumpScale:.12,side:base.side,toneMapped:false,envMapIntensity:.45});
        texture.needsUpdate=true;material.bumpMap=material.roughnessMap=material.specularIntensityMap=texture;
        record={material,texture,key:null,active:false};prints.set(base,record);
      }
      const {material,texture}=record,source=base.map;
      texture.offset.copy(source.offset);texture.repeat.copy(source.repeat);texture.center.copy(source.center);texture.rotation=source.rotation;texture.updateMatrix();
      material.map=source;material.color.copy(base.color);material.opacity=base.opacity;material.transparent=base.transparent;material.alphaTest=base.alphaTest;material.envMap=environment();
      const key=JSON.stringify([source.id,!!base.transparent,base.alphaTest,spec.separateSpines||0,spec.frontMask||null]);
      if(key!==record.key){record.key=key;configureCoverFinish(material,spec);material.needsUpdate=true;}
      swap(base,material);record.active=true;active=true;
    }
    if(active){for(const mesh of filmMeshes()){if(!hidden.has(mesh))hidden.set(mesh,mesh.visible);mesh.visible=false;}}
    else restoreFilms();
  }
  return {
    async load(path){clear();if(!path)return;const token=revision;controller=new AbortController();
      try{const image=await loadCoverMaterial(path,{imageSource,signal:controller.signal,flipY});if(token!==revision){image.close();return;}
        bitmap=image;packed=new THREE.Texture(bitmap);packed.colorSpace=THREE.NoColorSpace;packed.flipY=false;packed.premultiplyAlpha=false;packed.anisotropy=8;packed.needsUpdate=true;refresh();schedule();
      }catch(error){if(token===revision&&error.name!=='AbortError')console.warn('Cover material:',error);}
    },
    refresh,clear,dispose:clear,
    get active(){return [...prints.values()].some(value=>value.active);},get materials(){return [...prints.values()].map(value=>value.material);},get texture(){return packed;},
  };
}
