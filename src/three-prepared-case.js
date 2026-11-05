import * as THREE from './vendor/three/three.module.js';
import { mergeGeometries } from './vendor/three/BufferGeometryUtils.js';
import { clearCasePlastic } from './three-case-plastic.js';
import { configureAcrylicOptics } from './three-box-relief.js';
import { createDiscMaterial } from './three-disc-material.js';
import { loadPreparedModel } from './three-prepared-model.js';
import { longboxArtworkUV } from './three-box-artwork.js';

// Geometry and the opening rig are baked offline. Only materials, downloaded
// emblems and the variable-size booklet are configured for each viewer.
export async function loadPreparedCase(model) {
  const {scene,animations,manifest}=await loadPreparedModel(model);
  return attachCase(scene,animations,manifest);
}
function attachCase(scene,animations,manifest) {
  const profile=manifest.profile,{width:w,height:h,depth:d}=profile;
  let changed=()=>{},disposed=false,acrylicRibs=null;
  const longbox=profile.id==='longbox';
  const psp=profile.id==='psp';
  const clear=['ps3','ps4','xbox','xbox360','psp'].includes(profile.variant);
  const handheld=['ds','threeDs'].includes(profile.variant),cartridgeCase=handheld||profile.variant==='genesis';
  const dvdClips=profile.id==='dvd'||profile.variant==='gamecube'||handheld;
  const securityClips=profile.variant==='gamecube'||handheld;
  const bodyOpacity=variant=>({ps3:.07,ps4:.14,xbox:.20,xbox360:.12,psp:.18}[variant]??.07);
  const parts={};
  scene.traverse(node=>{if(node.userData.casePart)parts[node.userData.casePart]=node;});
  const plasticColor=color=>['#16191f','#202328','#282c32'].includes(color.toLowerCase())||longbox&&color.toLowerCase()==='#30343a'
    ||profile.variant==='gamecube'&&color.toLowerCase()==='#8b8f96'?'#343537':psp&&color.toLowerCase()==='#b9bdc3'?'#d9dcdf':color;
  const plastic=clear?clearCasePlastic(profile.color):new THREE.MeshPhysicalMaterial({color:plasticColor(profile.color),roughness:.84,metalness:0,
    specularIntensity:.16,envMapIntensity:.24,clearcoat:0,side:THREE.DoubleSide});plastic.name='Case Plastic';
  if(clear)plastic.opacity=bodyOpacity(profile.variant);
  plastic.color.set(plasticColor(profile.color));
  const raised=plastic.clone();raised.name='Case Raised Plastic';raised.roughness=clear?.30:.80;
  if(clear){raised.onBeforeCompile=plastic.onBeforeCompile;raised.customProgramCacheKey=plastic.customProgramCacheKey;}
  const acrylic=longbox?new THREE.MeshPhysicalMaterial({color:0xcddde5,roughness:.13,metalness:0,
    transparent:true,opacity:.035,depthWrite:false,forceSinglePass:true,ior:1.49,
    clearcoat:1,clearcoatRoughness:.08,side:THREE.DoubleSide,envMapIntensity:.45}):null;
  let ribbedPlastic=null,ribbedAcrylic=null;
  if(acrylic){
    acrylic.name='Case Acrylic';
    const ribs=new THREE.DataTexture(new Uint8Array([32,32,32,255,190,190,190,255,255,255,255,255,90,90,90,255]),4,1);
    ribs.wrapS=ribs.wrapT=THREE.RepeatWrapping;ribs.needsUpdate=true;
    ribbedPlastic=plastic.clone();ribbedPlastic.name='Case Ribbed Plastic';ribbedPlastic.bumpMap=ribs;ribbedPlastic.bumpScale=.12;
    ribbedAcrylic=acrylic.clone();ribbedAcrylic.name='Case Ribbed Acrylic';ribbedAcrylic.bumpMap=ribs;ribbedAcrylic.bumpScale=.18;
    ribbedAcrylic.opacity=.22;ribbedAcrylic.roughness=.22;ribbedAcrylic.clearcoat=.35;
    acrylicRibs=new THREE.TextureLoader().load(new URL('./models/dreamcast/ribs-height.svg',import.meta.url).href,texture=>{
      if(disposed){texture.dispose();return;}
      texture.colorSpace=THREE.NoColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
      ribbedAcrylic.bumpMap=ribbedAcrylic.alphaMap=texture;ribbedAcrylic.needsUpdate=true;changed();
    },undefined,()=>{/* Keep the initial molded ridges if the SVG cannot be loaded. */});
    configureAcrylicOptics(acrylic,{reliefMask:true});
  }
  const paper=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.FrontSide,toneMapped:false});paper.name='Paper Reverse';
  const cover=paper.clone();cover.name='Cover Outside';
  if(longbox)cover.alphaTest=.02;
  const inside=clear?paper.clone():null;if(inside){inside.name='Cover Inside';inside.alphaTest=.02;cover.alphaTest=.02;}
  // Add only the thin sleeve's reflections over the unlit print. Ordinary
  // alpha blending with a dark film dulls the scan instead of adding sheen.
  const film=new THREE.MeshPhysicalMaterial({color:0x000000,roughness:.13,clearcoat:.65,clearcoatRoughness:.10,
    metalness:0,specularIntensity:.45,envMapIntensity:.45,transparent:true,opacity:.22,
    blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.FrontSide});film.name='Sleeve Film';
  const disc=createDiscMaterial();disc.name='UMD Label';
  const silver=createDiscMaterial({silver:true});silver.name='Disc Silver';
  const genesis=profile.variant==='genesis';
  const cart=new THREE.MeshPhysicalMaterial({color:profile.variant==='threeDs'?0xeeeae5:genesis?0x202020:0x34363a,
    roughness:genesis?.8:.7,metalness:0,specularIntensity:genesis?.12:.16,envMapIntensity:genesis?.12:.2,side:THREE.DoubleSide});cart.name='Cartridge Plastic';
  const cartLabel=paper.clone();cartLabel.name='Cartridge Cover';
  const umdHousing=psp?new THREE.MeshPhysicalMaterial({name:'UMD Housing',color:0xe5e6e2,roughness:.38,metalness:0,
    specularIntensity:.18,envMapIntensity:.35,side:THREE.DoubleSide}):null;
  const umdWindow=psp?new THREE.MeshPhysicalMaterial({name:'UMD Window',color:0xffffff,roughness:.13,metalness:0,
    transparent:true,opacity:.10,depthWrite:false,specularIntensity:.3,envMapIntensity:.35,side:THREE.DoubleSide}):null;
  const surfaceMaterials=[plastic,raised,paper,cover,disc,silver,film,...(inside?[inside]:[]),...(cartridgeCase?[cart,cartLabel]:[]),...(acrylic?[acrylic,ribbedPlastic,ribbedAcrylic]:[]),...(psp?[umdHousing,umdWindow]:[])],decals=manifest.decals||[];
  const faceWidth=manifest.paperLayout.width,total=faceWidth*2+d;
  const byName=new Map(surfaceMaterials.map(mat=>[mat.name,mat]));
  const clipMeshes=[],shadowReceivers=[],shadowCasters=[],decalMeshes=new Map();
  const receiverMaterial=clear?new THREE.ShadowMaterial({color:0x17202b,opacity:.12,depthWrite:false,side:THREE.FrontSide}):null;
  const casterMaterial=clear?new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false,side:THREE.DoubleSide}):null;
  scene.traverse(mesh=>{
    if(!mesh.isMesh)return;
    if(mesh.userData.caseClip)clipMeshes.push(mesh);
    if(mesh.userData.caseDecal!==undefined){decalMeshes.set(mesh.userData.caseDecal,mesh);return;}
    if(mesh.userData.caseShadow==='receiver'){mesh.material=receiverMaterial;shadowReceivers.push(mesh);}
    else if(mesh.userData.caseShadow==='caster'){mesh.material=casterMaterial;shadowCasters.push(mesh);}
    else {
      mesh.material=byName.get(mesh.userData.caseMaterial);
      if(!mesh.material)throw Error('Unsupported prepared case material: '+mesh.userData.caseMaterial);
      if(longbox&&mesh.material===cover)longboxArtworkUV(mesh.geometry,manifest.spine_fraction);
    }
  });
  const brandURLs=new Map();
  const labelTextures=[],labelMaterials=[],labelCanvases=[];
  for(const decal of decals) {
    const canvas=document.createElement('canvas');canvas.width=Math.max(128,Math.ceil(decal.width*12));canvas.height=Math.max(64,Math.ceil(decal.height*12));
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.textAlign='center';context.textBaseline='middle';
    context.font=`bold ${decal.memory?canvas.height*.075:decal.fontSize?decal.fontSize/decal.height*canvas.height:canvas.height*.65}px Arial,sans-serif`;
    if(decal.memory){context.fillText('MEMORY CARD',canvas.width/2,canvas.height*.77);context.fillText('HOLDER',canvas.width/2,canvas.height*.86);}
    else context.fillText(decal.text,canvas.width/2,canvas.height/2,canvas.width*.95);
    const texture=new THREE.CanvasTexture(canvas);texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;
    const mat=raised.clone();mat.name=decal.name||(decal.brand?'Blu-ray Mark':decal.memory?'Memory Card Mark':'Push Mark');mat.map=texture;mat.transparent=true;mat.alphaTest=.2;
    if(clear){mat.opacity=.28;mat.onBeforeCompile=plastic.onBeforeCompile;mat.customProgramCacheKey=plastic.customProgramCacheKey;}
    const mesh=decalMeshes.get(decals.indexOf(decal));
    if(!mesh)throw Error('Prepared case is missing a molded caption');
    mesh.material=mat;
    mesh.userData.caseDecal=decals.indexOf(decal);
    labelTextures.push(texture);labelMaterials.push(mat);labelCanvases.push(canvas);
  }
  let booklet=null,lastSize=null,clipLift=0,feet=null;
  function clearManual() {clipLift=0;clipMeshes.forEach(mesh=>mesh.position.z=0);if(feet)feet.visible=false;lastSize=null;}
  function createManual({manualGroup,manualMeshes,manualFront,manualBack,manualPages,meshes}) {
    manualGroup.name='Case Booklet';parts.lid.add(manualGroup);booklet={group:manualGroup};
    const body=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),manualPages);body.castShadow=true;
    const sheet=material=>{const geometry=new THREE.PlaneGeometry(1,1),uv=geometry.attributes.uv;
      for(let i=0;i<uv.count;i++)uv.setY(i,1-uv.getY(i));return new THREE.Mesh(geometry,material);};
    const front=sheet(manualFront);front.rotation.y=longbox?0:Math.PI;front.position.z=longbox?.52:-.52;
    const back=sheet(manualBack);back.rotation.y=longbox?Math.PI:0;back.position.z=longbox?-.52:.52;
    for(const mesh of [body,front,back]){manualGroup.add(mesh);manualMeshes.push(mesh);meshes.push(mesh);}
    if(profile.variant!=='genesis'&&!longbox){
      const footGeometry=new THREE.BoxGeometry(dvdClips?4.5:4,dvdClips?10.4:16,1),footParts=[];
      for(const sign of psp?[0]:[-1,1]){const g=footGeometry.clone();g.translate(w/2-(securityClips?12.25:dvdClips?5.75:4.5),sign*h*(dvdClips?.415:.34),0);footParts.push(g);}
      feet=new THREE.Mesh(mergeGeometries(footParts),raised);footGeometry.dispose();footParts.forEach(g=>g.dispose());
      feet.name='Booklet Retainer Feet';
      feet.castShadow=feet.receiveShadow=true;feet.visible=false;parts.lid.add(feet);meshes.push(feet);
    }
  }
  function fitManual(image,data) {
    const size=globalThis.OpenCabinetManualPDF.dimensions(profile,{aspectRatio:image.width/image.height,pageCount:data?.pageCount||16});
    const {width,height,thickness,x,y}=size;
    booklet.group.scale.set(width,height,thickness);
    booklet.group.position.set(x,-y,d/2-(longbox?.3:1.33)-thickness/2);
    clipLift=profile.variant==='genesis'||longbox?0:Math.max(0,thickness-.55);clipMeshes.forEach(mesh=>mesh.position.z=-clipLift);
    if(feet){feet.scale.z=Math.max(.001,clipLift);feet.position.z=d/2-1.15-clipLift/2;feet.visible=clipLift>0;}
    lastSize=size;
  }
  function refreshBrand() {
    for(const key of new Set(decals.map(decal=>decal.memory?'playstation':decal.brand).filter(Boolean))){
      const url=document.documentElement.style.getPropertyValue('--box-brand-'+key).trim();
      if(brandURLs.get(key)===url)continue;brandURLs.set(key,url);
      const applies=decal=>(decal.memory?'playstation':decal.brand)===key;
      decals.forEach((decal,i)=>{if(!applies(decal))return;const canvas=labelCanvases[i];
        canvas.getContext('2d').clearRect(decal.brand?0:canvas.width*.32,decal.brand?0:canvas.height*.12,decal.brand?canvas.width:canvas.width*.36,decal.brand?canvas.height:canvas.height*.42);labelTextures[i].needsUpdate=true;
      });changed();
      const path=url.match(/^url\(["']?(.*?)["']?\)$/)?.[1];if(!path)continue;
      const image=new Image();image.crossOrigin='anonymous';image.onload=()=>{
        if(disposed||brandURLs.get(key)!==url)return;
        decals.forEach((decal,i)=>{if(!applies(decal))return;const canvas=labelCanvases[i],ctx=canvas.getContext('2d');
          const x=decal.brand?0:canvas.width*.32,y=decal.brand?0:canvas.height*.12,width=decal.brand?canvas.width:canvas.width*.36,height=decal.brand?canvas.height:canvas.height*.42;
          const scale=Math.min(width/image.width,height/image.height),ww=image.width*scale,hh=image.height*scale;
          ctx.clearRect(x,y,width,height);ctx.drawImage(image,x+(width-ww)/2,y+(height-hh)/2,ww,hh);
          ctx.globalCompositeOperation='source-in';ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.globalCompositeOperation='source-over';
          if(key==='wii'){
            // A shallow molded edge stays legible against the white shell.
            ctx.globalCompositeOperation='destination-over';ctx.shadowColor='rgba(0,0,0,.6)';
            ctx.shadowBlur=3;ctx.shadowOffsetX=1.5;ctx.shadowOffsetY=2;ctx.drawImage(canvas,0,0);
            ctx.shadowColor='transparent';ctx.shadowBlur=ctx.shadowOffsetX=ctx.shadowOffsetY=0;ctx.globalCompositeOperation='source-over';
          }
          labelTextures[i].needsUpdate=true;
        });changed();
      };image.src=path;
    }
  }
  function selectArtwork(images) {
    if(profile.variant!=='genesis')return;
    const label=images.some(image=>image.kind==='cart_label'&&image.path),cartW=Math.min(110,h-28),cartH=Math.min(70,w-40);
    scene.traverse(mesh=>{if(mesh.material===cartLabel)mesh.scale.set(label?1:cartH/(cartH-18),label?1:cartW/(cartW-18),1);});
  }
  function update(next) {
    plastic.color.set(plasticColor(next.color));raised.color.copy(plastic.color);
    ribbedPlastic?.color.copy(plastic.color);
    if(clear)plastic.opacity=raised.opacity=bodyOpacity(next.variant);
    labelMaterials.forEach(mat=>mat.color.copy(plastic.color).lerp(new THREE.Color(0xffffff),.12));refreshBrand();
  }
  // Console artwork can finish loading after the case was selected. Observe
  // that infrequent configuration change, never computed styles during a drag.
  const brandObserver=new MutationObserver(refreshBrand);
  brandObserver.observe(document.documentElement,{attributes:true,attributeFilter:['style']});
  let lightingKey=null,shadowLight=null;
  function configureLighting({renderer,keyLight}) {
    if(acrylicRibs)acrylicRibs.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    shadowLight=keyLight;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
    keyLight.castShadow=true;keyLight.shadow.mapSize.set(2048,2048);
    Object.assign(keyLight.shadow.camera,{left:-240,right:240,top:240,bottom:-240,near:1,far:850});
    keyLight.shadow.camera.updateProjectionMatrix();keyLight.shadow.bias=-.00015;keyLight.shadow.normalBias=.18;
  }
  function beforeRender({renderer,root,opened}) {
    shadowReceivers.forEach(mesh=>mesh.visible=opened>0);
    shadowCasters.forEach(mesh=>mesh.visible=opened>0);
    const key=[...root.quaternion.toArray(),...root.scale.toArray(),opened,!!booklet?.group.visible,clipLift].join(',');
    if(key!==lightingKey){lightingKey=key;renderer.shadowMap.needsUpdate=true;}
  }
  function releaseLighting() {
    shadowLight?.shadow.dispose();
    if(shadowLight){shadowLight.shadow.map=null;shadowLight.shadow.mapPass=null;}
    lightingKey=null;
  }
  function paperReverse(pictures) {
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=4;
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,256,4);
    if(!pictures.full&&!pictures.spine){const face=256*faceWidth/total;context.clearRect(face,0,256*d/total,4);}
    return canvas;
  }
  function onManualCover(image) {
    // The booklet is the front insert of a jewel case. Its own back replaces
    // the unprinted paper plane, including while the booklet is extracted.
    if(longbox)for(const mesh of parts.lid.children)if(mesh.material===paper)mesh.visible=!image;
  }
  return {scene,animations,animationNames:['Open Case'],manifest,createManual,fitManual,clearManual,update,
    configureLighting,beforeRender,releaseLighting,selectArtwork,
    ...(longbox?{manualCover:true,onManualCover,separateSpines:true}:{}),
    ...(clear?{clearSpine:true,paperReverse}:{}),
    sourceFaceCount:manifest.sourceFaceCount,materials:surfaceMaterials,parts,get manualSize(){return lastSize;},
    onChange(callback){changed=callback;},dispose(){disposed=true;brandObserver.disconnect();acrylicRibs?.dispose();releaseLighting();}};
}
