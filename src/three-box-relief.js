import * as THREE from './vendor/three/three.module.js';

// Shadow only the raised walls. Treating a clear plastic sheet as an opaque
// shadow caster would darken the entire artwork underneath it.
export function wallShadowGeometry(geometry,planeZ,inside=false) {
  const positions=geometry.attributes.position,index=geometry.index,vertices=[];
  const count=index?index.count:positions.count;
  for(let i=0;i<count;i+=3) {
    const ids=[0,1,2].map(j=>index?index.getX(i+j):i+j);
    const p=ids.map(id=>[positions.getX(id),positions.getY(id),positions.getZ(id)]);
    const height=(p[0][2]+p[1][2]+p[2][2])/3-planeZ;
    if(inside?height>-.15:height<.15)continue;
    const a=p[1].map((n,j)=>n-p[0][j]),b=p[2].map((n,j)=>n-p[0][j]);
    const normal=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=Math.hypot(...normal);
    if(length<1e-8||Math.abs(normal[2])/length>.8)continue;
    vertices.push(...p[0],...p[1],...p[2]);
  }
  const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  result.computeBoundingBox();result.computeBoundingSphere();return result;
}

export function createContactShadows(renderer,light,{rear,lidShell,paper,manualBack}) {
  // Select a supported filter before compiling any visible materials.
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.shadowMap.autoUpdate=false;
  light.castShadow=true;light.shadow.mapSize.set(2048,2048);
  Object.assign(light.shadow.camera,{left:-220,right:220,top:220,bottom:-220,near:10,far:1000});
  light.shadow.camera.updateProjectionMatrix();light.shadow.bias=-.00006;light.shadow.normalBias=.04;
  const shadowMaterial=new THREE.ShadowMaterial({color:0x0c1420,opacity:.18,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
  const casterMaterial=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false,side:THREE.DoubleSide});
  const casters=[],receivers=[];
  for(const [shell,surface,inside] of [[rear,paper,false],[lidShell,manualBack,true]]) {
    // Folded inserts include raised side flaps. Their bounding-box center is
    // not the paper floor: use the largest front/back-facing paper triangle.
    const p=surface.geometry.attributes.position,index=surface.geometry.index;
    let best=0,planeZ=surface.geometry.boundingBox.min.z;
    for(let i=0;i<(index?index.count:p.count);i+=3) {
      const ids=[0,1,2].map(j=>index?index.getX(i+j):i+j);
      const nz=(p.getX(ids[1])-p.getX(ids[0]))*(p.getY(ids[2])-p.getY(ids[0]))-(p.getY(ids[1])-p.getY(ids[0]))*(p.getX(ids[2])-p.getX(ids[0]));
      if(nz*(inside?-1:1)>0&&Math.abs(nz)>best){best=Math.abs(nz);planeZ=ids.reduce((sum,id)=>sum+p.getZ(id),0)/3;}
    }
    const geometry=wallShadowGeometry(shell.geometry,planeZ,inside),caster=new THREE.Mesh(geometry,casterMaterial);
    caster.name=inside?'lid-relief-caster':'rear-relief-caster';caster.castShadow=true;shell.parent.add(caster);casters.push(caster);
    const receiver=new THREE.Mesh(surface.geometry,shadowMaterial);
    receiver.name=inside?'manual-contact-shadow':'inlay-contact-shadow';receiver.position.copy(surface.position);
    receiver.position.z+=inside?-.035:.035;receiver.receiveShadow=true;receiver.renderOrder=2;surface.parent.add(receiver);receivers.push(receiver);
  }
  let previous=null;
  return {casters,receivers,shadowMaterial,
    update(amount,pose,manualExtracted=false) {
      casters.forEach(mesh=>mesh.visible=amount>0);
      receivers[0].visible=amount>0;receivers[1].visible=amount>0&&!manualExtracted;
      if(amount>0&&pose!==previous){renderer.shadowMap.needsUpdate=true;previous=pose;}
    },
    reset(){
      previous=null;
      // Allocate a valid depth map even when the first frame is closed. With
      // deferred updates, Three.js otherwise binds a non-comparison fallback
      // texture to PCF samplers, rejecting acrylic draws (GL_INVALID_OPERATION).
      renderer.shadowMap.needsUpdate=true;
      casters.forEach(mesh=>mesh.visible=false);receivers.forEach(mesh=>mesh.visible=false);
    },
    dispose(){casters.forEach(mesh=>{mesh.geometry.dispose();mesh.removeFromParent();});receivers.forEach(mesh=>mesh.removeFromParent());shadowMaterial.dispose();casterMaterial.dispose();light.shadow.dispose();},
  };
}

export function configureAcrylicOptics(material) {
  // Transmission supplies Three.js's opaque-scene buffer. Blend the thin
  // sheets lightly, but refract through the thicker molded walls instead of
  // painting a brighter outline over them. Keep the printed artwork unlit.
  Object.assign(material,{transmission:1,opacity:1,thickness:.65,ior:1.49,
    attenuationDistance:120,roughness:.08,clearcoat:0,toneMapped:false});
  material.color.set(0xffffff);material.attenuationColor.set(0xe4eff6);
  material.onBeforeCompile=shader=>{
    shader.uniforms.acrylicScatterDensity={value:.06};
    shader.vertexShader=`varying float vAcrylicRelief;\n${shader.vertexShader}`.replace('#include <begin_vertex>',`
      vAcrylicRelief = smoothstep(0.04, 0.8, 1.0 - abs(normalize(normal).z));
      #include <begin_vertex>
    `);
    shader.fragmentShader=`uniform float acrylicScatterDensity;\nvarying float vAcrylicRelief;\n${shader.fragmentShader}`;
    // Use one sharp sample: rough bicubic refraction blurs the scan, whereas
    // molded case plastic mainly displaces it at each change of surface angle.
    shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_fragment>',
      'material.transmissionAlpha = 1.0;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      vec3 acrylicView = normalize(vViewPosition);
      // Some inside faces in the supplied OBJ have normals opposed to their
      // winding. Orient the air/plastic interface toward the viewer; otherwise
      // Fresnel becomes 100% reflection and turns the entire insert gray.
      vec3 acrylicSurfaceNormal = faceforward(normal, -acrylicView, normal);
      float acrylicCos = clamp(dot(acrylicSurfaceNormal, acrylicView), 0.0, 1.0);
      float acrylicF0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
      float acrylicFresnel = acrylicF0 + (1.0 - acrylicF0) * pow(1.0 - acrylicCos, 5.0);
      float acrylicThickness = thickness * mix(1.0, 3.0, vAcrylicRelief);
      vec3 acrylicNormal = transformNormalByInverseViewMatrix(acrylicSurfaceNormal, viewMatrix);
      vec3 acrylicRay = getVolumeTransmissionRay(acrylicNormal, normalize(cameraPosition - vWorldPosition), acrylicThickness, ior, modelMatrix);
      vec4 acrylicClip = projectionMatrix * viewMatrix * vec4(vWorldPosition + acrylicRay, 1.0);
      vec2 acrylicUV = clamp(acrylicClip.xy / acrylicClip.w * 0.5 + 0.5, vec2(0.001), vec2(0.999));
      vec4 acrylicBehind = texture2D(transmissionSamplerMap, acrylicUV);
      // Three.js clears this buffer to alpha 0.5 over a CSS background. That
      // fallback is not an object behind the glass: retain only reflections.
      float acrylicCoverage = clamp((acrylicBehind.a - 0.5) * 2.0, 0.0, 1.0);
      float acrylicRefraction = mix(0.035, 0.9, vAcrylicRelief) * acrylicCoverage;
      vec3 acrylicAbsorption = pow(max(attenuationColor, vec3(0.001)), vec3(length(acrylicRay) / attenuationDistance));
      vec3 acrylicReflection = getIBLRadiance(acrylicView, acrylicSurfaceNormal, roughness);
      // A molded fold exposes a longer path through closely spaced plastic
      // interfaces. Its soft whitish body scattering remains visible under
      // indirect light, even when no specular highlight points at the camera.
      // Each visible interface blends normally, so overlapping layers build up
      // this cue; broad flat sheets keep zero scattering and do not bleach art.
      float acrylicScatter = vAcrylicRelief * min(0.35, 1.0 - exp(-acrylicScatterDensity * acrylicThickness / max(acrylicCos, 0.18)));
      vec3 acrylicAmbient = clamp(getIBLIrradiance(acrylicSurfaceNormal) / PI + vec3(0.25), vec3(0.35), vec3(0.85));
      acrylicAmbient *= sqrt(attenuationColor);
      float acrylicScattered = acrylicScatter;
      float acrylicReflected = (1.0 - acrylicScatter) * acrylicFresnel;
      float acrylicTransmitted = (1.0 - acrylicFresnel) * (1.0 - acrylicScatter) * acrylicRefraction;
      float acrylicAlpha = acrylicReflected + acrylicScattered + acrylicTransmitted;
      outgoingLight = (acrylicTransmitted * acrylicBehind.rgb * acrylicAbsorption
        + acrylicReflected * acrylicReflection + acrylicScattered * acrylicAmbient) / max(acrylicAlpha, 0.001);
      diffuseColor.a = acrylicAlpha;
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey=()=> 'opencabinet-acrylic-refraction-v2';
}
