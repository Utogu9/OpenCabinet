import * as THREE from './vendor/three/three.module.js';

// The printed label still catches light from the disc underneath it. Keep the
// same optical finish across imported and converted CD/DVD/Blu-ray cases.
export function createDiscMaterial({silver=false}={}) {
  const material=new THREE.MeshStandardMaterial({color:silver?0xc3cedb:0xbbc5d5,
    metalness:silver?.9:.45,roughness:silver?.19:.25,side:THREE.DoubleSide});
  if(silver)configureDiscReverse(material);
  return material;
}

export function prepareDiscReverse(geometry) {
  if(geometry.getAttribute('discCoordinates'))return;
  geometry.computeBoundingBox();const box=geometry.boundingBox,size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const sizes=size.toArray(),thin=sizes.indexOf(Math.min(...sizes)),axes=[0,1,2].filter(axis=>axis!==thin);
  const radius=Math.max(sizes[axes[0]],sizes[axes[1]],1e-6)/2,position=geometry.attributes.position;
  const coordinates=new Float32Array(position.count*2),radials=new Float32Array(position.count*3);
  const c=center.toArray();
  for(let i=0;i<position.count;i++)for(let j=0;j<2;j++){
    const axis=axes[j],value=(position.getComponent(i,axis)-c[axis])/radius;
    coordinates[i*2+j]=value;radials[i*3+axis]=value;
  }
  geometry.setAttribute('discCoordinates',new THREE.BufferAttribute(coordinates,2));
  geometry.setAttribute('discRadial',new THREE.BufferAttribute(radials,3));
}

// A radial diffraction finish needs no bitmap, animation loop or network
// texture. Geometry coordinates work with all the existing CD/DVD/UMD UV maps.
export function configureDiscReverse(material) {
  material.onBeforeCompile=shader=>{
    shader.vertexShader=`attribute vec2 discCoordinates;\nattribute vec3 discRadial;\nvarying vec2 vDiscCoordinates;\nvarying vec3 vDiscRadial;\n`+shader.vertexShader.replace('#include <begin_vertex>',`
      #include <begin_vertex>
      vDiscCoordinates=discCoordinates;
      vDiscRadial=mat3(modelViewMatrix)*discRadial;
    `);
    shader.fragmentShader=`varying vec2 vDiscCoordinates;\nvarying vec3 vDiscRadial;\n`+shader.fragmentShader.replace('#include <opaque_fragment>',`
      float discRadius=length(vDiscCoordinates);
      float discPixel=max(fwidth(discRadius),0.0001);
      float discData=smoothstep(0.235,0.27,discRadius)*(1.0-smoothstep(0.97,1.0,discRadius));
      vec3 discView=normalize(vViewPosition);
      vec3 discLight=normalize(vec3(-0.6,0.6,1.0));
      #if NUM_DIR_LIGHTS > 0
        discLight=directionalLights[0].direction;
      #endif
      float discFacing=abs(dot(normal,discView));
      float discGrating=dot(normalize(vDiscRadial+vec3(0.00001)),normalize(discView+discLight));
      float discPhase=discGrating*18.0+(1.0-discFacing)*3.0+discRadius*0.6;
      vec3 discSpectrum=0.5+0.5*cos(vec3(discPhase)+vec3(0.0,2.094395,4.18879));
      float discSheen=(0.20+0.18*pow(1.0-discFacing,0.6))*(0.35+0.65*pow(abs(discGrating),0.45));
      float discGrooves=sin(discRadius*1600.0)*0.012*(1.0-smoothstep(0.002,0.012,discPixel));
      float discInnerRing=1.0-smoothstep(discPixel,discPixel*2.0+0.003,abs(discRadius-0.235));
      float discOuterRing=1.0-smoothstep(discPixel,discPixel*2.0+0.003,abs(discRadius-0.98));
      float discHub=1.0-smoothstep(0.17,0.22,discRadius);
      outgoingLight=max(vec3(0.0),outgoingLight*(1.0-discHub*0.16+discGrooves*discData)
        +(discSpectrum-0.25)*discSheen*discData+vec3(discInnerRing*0.12+discOuterRing*0.06));
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey=()=> 'opencabinet-optical-disc-reverse-v1';
}
