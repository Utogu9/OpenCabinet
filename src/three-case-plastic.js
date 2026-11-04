import * as THREE from './vendor/three/three.module.js';

// Thin translucent case molding. Blend its haze and grazing reflections over
// the paper directly; screen-space refraction can displace unrelated artwork
// onto the walls and clips of these shallow, closely spaced surfaces.
export function clearCasePlastic(color) {
  const material=new THREE.MeshPhysicalMaterial({color,roughness:.34,metalness:0,transmission:0,
    transparent:true,opacity:.07,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,
    specularIntensity:.28,envMapIntensity:.20,clearcoat:0});
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying float vCaseMolding;\n'+shader.vertexShader.replace('#include <begin_vertex>',`
      vCaseMolding = smoothstep(0.08, 0.75, 1.0 - abs(normalize(normal).z));
      #include <begin_vertex>
    `);
    shader.fragmentShader='varying float vCaseMolding;\n'+shader.fragmentShader.replace('#include <opaque_fragment>',`
      float caseCos = abs(dot(normalize(normal), normalize(vViewPosition)));
      float caseFresnel = pow(1.0 - clamp(caseCos, 0.0, 1.0), 4.0);
      float caseAlpha = clamp(opacity + 0.14 * vCaseMolding + 0.28 * caseFresnel, 0.0, 0.55);
      // Reduce the transmitted background by 10% at every viewing angle.
      diffuseColor.a = 1.0 - (1.0 - caseAlpha) * 0.9;
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey=()=> 'opencabinet-clear-case-v2';
  return material;
}
