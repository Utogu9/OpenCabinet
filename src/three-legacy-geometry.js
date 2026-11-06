import * as THREE from './vendor/three/three.module.js';
import { mergeGeometries } from './vendor/three/BufferGeometryUtils.js';
import { clearCasePlastic } from './three-case-plastic.js';
import { wallShadowGeometry, configureAcrylicOptics, maskClearPanels } from './three-box-relief.js';
import { createDiscMaterial, prepareDiscReverse } from './three-disc-material.js';

// CSS faces use X right, Y down, Z out of the cover. Convert both the local
// plane and its transform to Three's Y-up convention, keeping millimetres.
const flip=new THREE.Matrix4().makeScale(1,-1,1);
const templates=new Map();
export function faceMatrix(transform) {
  const css=new DOMMatrix(transform||undefined);
  return new THREE.Matrix4().multiplyMatrices(flip,new THREE.Matrix4().fromArray(css.toFloat64Array())).multiply(flip);
}
function length(value,size) {
  // Computed clip paths can retain calc(), but only sums of lengths occur in
  // the case definitions. No script evaluation is needed to resolve them.
  return [...String(value).replace(/calc\(|\)/g,'').replace(/\s+/g,'').matchAll(/([+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?)(%|px)?/gi)]
    .reduce((sum,m)=>sum+Number(m[1])*(m[2]==='%'?size/100:1),0);
}
function components(value) {
  return String(value).match(/calc\([^)]*\)|[^\s]+/g)||[];
}
function roundedRect(x,y,w,h,radii=[0,0,0,0]) {
  const result=[];
  for(const [cx,cy,start,radius] of [[x+radii[0],y+radii[0],180,radii[0]],
    [x+w-radii[1],y+radii[1],270,radii[1]],[x+w-radii[2],y+h-radii[2],0,radii[2]],
    [x+radii[3],y+h-radii[3],90,radii[3]]]) {
    const steps=radius?10:1;
    for(let i=0;i<=steps;i++){const a=(start+i*90/steps)*Math.PI/180;result.push([cx+radius*Math.cos(a),cy+radius*Math.sin(a)]);}
  }
  return result;
}
function circle(cx,cy,r) {return Array.from({length:96},(_,i)=>[cx+r*Math.cos(i*Math.PI/48),cy+r*Math.sin(i*Math.PI/48)]);}
function intersectConvex(subject,boundary) {
  // CSS applies border-radius AND clip-path. Clipping a polygon must retain
  // the curved silhouette too, otherwise the face overhangs its molded walls.
  const side=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  for(let i=0;i<boundary.length&&subject.length;i++) {
    const a=boundary[i],b=boundary[(i+1)%boundary.length];
    if(Math.hypot(b[0]-a[0],b[1]-a[1])<1e-8)continue;
    const output=[];
    for(let j=0;j<subject.length;j++) {
      const p=subject[j],q=subject[(j+1)%subject.length],sp=side(a,b,p),sq=side(a,b,q);
      const pin=sp>=-1e-8,qin=sq>=-1e-8;
      if(pin)output.push(p);
      if(pin!==qin){const t=sp/(sp-sq);output.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
    }
    subject=output;
  }
  return subject;
}
function closingLip(profile) {
  const {width:w,height:h}=profile,channel=globalThis.OpenCabinetDVD.openingChannel(profile);
  const genesis=profile.id==='genesis',openingInset=genesis?2.6:0,endInset=genesis?3.8:0;
  const outline=inset=>{
    const hinge=genesis?.65:1.3;
    const points=roundedRect(-w/2+inset,-h/2+endInset+inset,w-openingInset-2*inset,h-2*endInset-2*inset,
      [Math.max(.2,(profile.variant==='ps3'?3.2:hinge)-inset),3.2-inset,3.2-inset,Math.max(.2,hinge-inset)]);
    const result=[],right=w/2-openingInset-inset,half=h*(channel?.length||0)/2;
    for(let i=0;i<points.length;i++){
      const p=points[i],q=points[(i+1)%points.length];result.push(p);
      if(channel&&Math.abs(p[0]-right)<1e-6&&Math.abs(q[0]-right)<1e-6&&p[1]<-half&&q[1]>half)
        result.push([right,-half],[right-channel.intrusion,-half],[right-channel.intrusion,half],[right,half]);
    }
    return result.map(([x,y])=>new THREE.Vector2(x,-y));
  };
  // The rear half has a short overlapping flange behind the closing seam.
  // It blocks the line of sight through the small gap between both molded rims.
  const shape=new THREE.Shape(outline(.8));shape.holes.push(new THREE.Path(outline(1.4)));
  return new THREE.ExtrudeGeometry(shape,{depth:1.3,bevelEnabled:false,steps:1}).translate(0,0,-.5);
}
function svgContours(mask,w,h,luminance) {
  const encoded=mask.match(/data:image\/svg\+xml,([^"']*)/);
  if(!encoded)return null;
  const svg=new DOMParser().parseFromString(decodeURIComponent(encoded[1]),'image/svg+xml').documentElement;
  const box=(svg.getAttribute('viewBox')||`0 0 ${w} ${h}`).split(/\s+/).map(Number),sx=w/box[2],sy=h/box[3];
  const white=[],black=[];
  for(const node of svg.querySelectorAll('rect,polygon,circle')) {
    const attr=(key,base,fallback=0)=>node.hasAttribute(key)?length(node.getAttribute(key),base):fallback;
    let points;
    if(node.tagName==='polygon') {
      const nums=(node.getAttribute('points')||'').trim().split(/[\s,]+/).map(Number);
      points=Array.from({length:nums.length/2},(_,i)=>[nums[i*2],nums[i*2+1]]);
    } else if(node.tagName==='circle')points=circle(attr('cx',box[2]),attr('cy',box[3]),attr('r',box[2]));
    else {const r=attr('rx',box[2]);points=roundedRect(attr('x',box[2]),attr('y',box[3]),attr('width',box[2]),attr('height',box[3]),[r,r,r,r]);}
    const fill=node.getAttribute('fill')||node.parentElement?.getAttribute('fill')||'white';
    (luminance&&fill==='black'?black:white).push(points.map(([x,y])=>[(x-box[0])*sx,(y-box[1])*sy]));
  }
  return white.map(outline=>({outline,holes:black.filter(hole=>pointInside(hole[0],outline))}));
}
function pointInside([x,y],points) {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const [xi,yi]=points[i],[xj,yj]=points[j];
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
  }
  return inside;
}
function contours(face,style) {
  const w=face.width,h=face.height,mask=style.maskImage;
  if(face.element.classList.contains('game-box-grab-lip')) {
    // This mask has an opening that reaches outside the silhouette, not an
    // enclosed hole. Feeding it to Earcut as a hole fills the entire cover.
    const svg=new DOMParser().parseFromString(decodeURIComponent(mask.match(/data:image\/svg\+xml,([^"']*)/)[1]),'image/svg+xml');
    const left=Number(svg.querySelector('rect[fill="black"]').getAttribute('x'))<0;
    const outline=roundedRect(0,0,w,h,[.65,.65,.65,.65]),points=[];
    for(let i=0;i<outline.length;i++){
      const p=outline[i],q=outline[(i+1)%outline.length];points.push(p);
      if(left&&p[0]<1e-6&&q[0]<1e-6&&p[1]>q[1])points.push([0,h-4.6],[w-4.6,h-4.6],[w-4.6,4.6],[0,4.6]);
      if(!left&&Math.abs(p[0]-w)<1e-6&&Math.abs(q[0]-w)<1e-6&&p[1]<q[1])points.push([w,4.6],[4.6,4.6],[4.6,h-4.6],[w,h-4.6]);
    }
    return [{outline:points,holes:[]}];
  }
  const cornerRadii=(width,height)=>['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius']
    .map(key=>Math.min(width/2,height/2,length(style[key],Math.min(w,h))));
  const svg=svgContours(mask,w,h,style.maskMode==='luminance');
  if(svg)return svg;
  if(mask.startsWith('radial-gradient')) {
    const stops=[...mask.matchAll(/([\d.]+)%/g)].map(m=>Number(m[1]));
    const r=Math.min(w,h)/2,inner=r*(stops[1]||stops[0]||0)/100;
    return [{outline:circle(w/2,h/2,r),holes:inner?[circle(w/2,h/2,inner)]:[]}];
  }
  const clip=style.clipPath;
  if(clip.startsWith('polygon(')) {
    const polygon=clip.replace(/^polygon\(|\)$/g,'').split(',').map(pair=>{
      const [x,y]=components(pair.trim());return [length(x,w),length(y,h)];
    });
    const radii=cornerRadii(w,h);
    return [{outline:radii.some(r=>r>0)?intersectConvex(polygon,roundedRect(0,0,w,h,radii)):polygon,holes:[]}];
  }
  let x=0,y=0,width=w,height=h;
  if(clip.startsWith('inset(')) {
    const values=components(clip.slice(6,-1).split(' round ')[0]);
    const [top,right,bottom,left]=[values[0],values[1]||values[0],values[2]||values[0],values[3]||values[1]||values[0]];
    x=length(left,w);y=length(top,h);width-=x+length(right,w);height-=y+length(bottom,h);
  }
  const radii=cornerRadii(width,height);
  return [{outline:roundedRect(x,y,width,height,radii),holes:[]}];
}
export function faceGeometry(face,{style=getComputedStyle(face.element),uv=(x,y)=>[x/face.width,y/face.height],offset=0}={}) {
  const geometry=new THREE.BufferGeometry(),positions=[],normals=[],uvs=[];
  const transform=faceMatrix(face.transform(1)),normal=new THREE.Vector3(face.normal[0],-face.normal[1],face.normal[2]);
  for(const {outline,holes} of contours(face,style)) {
    const clean=points=>points.filter((p,i)=>!i||Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1])>1e-7).map(([x,y])=>new THREE.Vector2(x,y));
    const outer=clean(outline),inner=holes.map(clean);
    const triangles=THREE.ShapeUtils.triangulateShape(outer,inner);
    const points=[...outer,...inner.flat()];
    for(const triangle of triangles) {
      const vertices=triangle.map(i=>new THREE.Vector3(points[i].x-face.width/2,-points[i].y+face.height/2,offset).applyMatrix4(transform));
      if(new THREE.Vector3().subVectors(vertices[1],vertices[0]).cross(new THREE.Vector3().subVectors(vertices[2],vertices[0])).dot(normal)<0){triangle.reverse();vertices.reverse();}
      triangle.forEach((index,i)=>{
        const point=points[index],vertex=vertices[i];positions.push(vertex.x,vertex.y,vertex.z);
        let n=normal;
        if(face.curve){const [a,b]=face.curve.normals,t=Math.max(0,Math.min(1,point.x/face.width));n=new THREE.Vector3(a[0],-a[1],a[2]).lerp(new THREE.Vector3(b[0],-b[1],b[2]),t).normalize();}
        normals.push(n.x,n.y,n.z);uvs.push(...uv(point.x,point.y));
      });
    }
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  return geometry;
}

// Batch the legacy pieces by articulated half and material. A thousand CSS
// planes become a handful of GPU draws; only three group matrices animate.
export function convertLegacyCase(sourceFactory,templateKey) {
  const template=templates.get(templateKey),source=template?null:sourceFactory();
  const snapshot=template||source.capture(),profile=snapshot.profile,{width:w,height:h,depth:d}=profile;
  let changed=()=>{},disposed=false,acrylicRibs=null;
  const longbox=profile.id==='longbox';
  const psp=profile.id==='psp';
  const clear=['ps3','ps4','xbox','xbox360','psp'].includes(profile.variant);
  const handheld=['ds','threeDs'].includes(profile.variant),cartridgeCase=handheld||profile.variant==='genesis';
  const dvdClips=profile.id==='dvd'||profile.variant==='gamecube'||handheld;
  const securityClips=profile.variant==='gamecube'||handheld;
  const bodyOpacity=variant=>({ps3:.07,ps4:.14,xbox:.20,xbox360:.12,psp:.18}[variant]??.07);
  const scene=new THREE.Group(),parts={},batches=new Map();
  for(const name of ['tray','spine','lid']){const group=new THREE.Group();group.name=`Case ${name}`;scene.add(group);parts[name]=group;}
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
  const surfaceMaterials=[plastic,raised,paper,cover,disc,silver,film,...(inside?[inside]:[]),...(cartridgeCase?[cart,cartLabel]:[]),...(acrylic?[acrylic,ribbedPlastic,ribbedAcrylic]:[]),...(psp?[umdHousing,umdWindow]:[])],decals=template?.decals||[];
  const faceWidth=snapshot.paperLayout.width,total=faceWidth*2+d;
  function artUV(kind,u,v) {
    return [(kind==='back_cover'?u*faceWidth:kind==='spine'?faceWidth+u*d:faceWidth+d+u*faceWidth)/total,v];
  }
  function batch(face,geometry,mat,category='body') {
    if(!geometry.attributes.position.count){geometry.dispose();return;}
    const part=face.part||'tray',key=`${part}:${mat.name}:${category}`;
    if(!batches.has(key))batches.set(key,{part,material:mat,geometries:[],category});
    batches.get(key).geometries.push(geometry);
  }
  for(const face of template?[]:snapshot.faces) {
    if(face.paperOccluded)continue;
    const element=face.element,name=element.className,style=getComputedStyle(element),kind=element.dataset.face;
    // These old closed-only side planes are CSS proxies for walls which now
    // exist as real geometry. Keeping both causes z-fighting and hides the notch.
    if(face.closedOnly||(!face.interior&&/game-box-corner/.test(name)))continue;
    if(element.dataset.paperFace||element.dataset.paperSource){if(!clear)batch(face,faceGeometry(face,{style}),paper);continue;}
    if(face.texture) {
      const t=face.texture;
      batch(face,faceGeometry(face,{style,offset:.025,uv:(x,y)=>artUV(t.art,(t.u+(x-face.width/2)/t.sx)/t.width,(t.v+(y-face.height/2)/t.sy)/t.height)}),cover);
      batch(face,faceGeometry(face,{style,offset:.065}),film);continue;
    }
    if(kind&&['front','back','left',...(longbox?['right']:[])].includes(kind)) {
      const transform=face.transform;
      // CSS expands each plane by a display pixel to hide compositing cracks.
      // The GPU shares one depth buffer and must keep the physical dimensions.
      const shell={...face,transform:s=>transform(s).replace(/ scale\([^)]*\)/g,'')};
      if(!longbox||kind!=='front')batch(shell,faceGeometry(shell,{style}),acrylic||plastic);
      const image=element.querySelector('img');
      if(image) {
        const x=length(image.style.left,face.width),y=length(image.style.top,face.height);
        const width=length(image.style.width,face.width),height=length(image.style.height,face.height);
        const artFace={...shell,width,height,curve:null,transform:s=>`${shell.transform(s)} translate3d(${(x+width/2-face.width/2)*s}px,${(y+height/2-face.height/2)*s}px,${.035*s}px)`};
        const artStyle={maskImage:'none',clipPath:'none',borderTopLeftRadius:'0',borderTopRightRadius:'0',borderBottomLeftRadius:'0',borderBottomRightRadius:'0'};
        batch(artFace,faceGeometry(artFace,{style:artStyle,uv:(u,v)=>artUV(kind==='front'?'cover':kind==='back'?'back_cover':'spine',u/width,v/height)}),cover);
        batch(artFace,faceGeometry(artFace,{style:artStyle,offset:.04}),film);
      }
      continue;
    }
    if(clear&&/game-box-ps3-header-plate/.test(name)) {
      const ww=22,hh=11.8,x=w/2-5.5-ww/2;
      const mark={...face,width:ww,height:hh,transform:s=>`${face.transform(s)} translate3d(${x*s}px,0,${.02*s}px)`};
      decals.push({part:face.part,width:ww,height:hh,geometry:faceGeometry(mark,{style:{maskImage:'none',clipPath:'none'}}),brand:'bluray',text:''});
    }
    // Text and emblems have a transparent CSS background, not a plastic plate.
    if(/dvd-memory-slot|dvd-brand|dvd-hub-label/.test(name)) {
      if(/memory-slot|hub-label/.test(name))decals.push({part:face.part,width:face.width,height:face.height,
        geometry:faceGeometry(face,{style,offset:.015}),memory:/memory-slot/.test(name),text:element.textContent});
      const brandKeys=[['.game-box-gamecube-logo','gamecube-logo'],['.game-box-sega-mark','sega'],
        ['.wii-mark','wii'],['.wiiu-mark','nintendo'],['.game-box-handheld-logo.three-ds','three-ds'],['.game-box-handheld-logo.ds','ds']];
      for(const [selector,brand] of brandKeys){
        const mark=element.querySelector(selector);if(!mark)continue;
        const ms=getComputedStyle(mark),ww=length(ms.width,face.width)||face.width,hh=length(ms.height,face.height)||face.height;
        const x=mark.offsetLeft+ww/2-face.width/2,y=mark.offsetTop+hh/2-face.height/2;
        const markFace={...face,width:ww,height:hh,transform:s=>`${face.transform(s)} translate3d(${x*s}px,${y*s}px,${.02*s}px)`};
        decals.push({part:face.part,width:ww,height:hh,geometry:faceGeometry(markFace,{style:{maskImage:'none',clipPath:'none'}}),brand,text:'',name:'Console Mark '+brand});
      }
      if(!element.children.length&&element.textContent.trim()&&!/hub-label/.test(name))decals.push({part:face.part,width:face.width,height:face.height,
        geometry:faceGeometry(face,{style,offset:.015}),text:element.textContent,fontSize:parseFloat(style.fontSize),name:'Molded Caption'});
      continue;
    }
    let mat=/dvd-cartridge-label/.test(name)?cartLabel:/dvd-cartridge(?:\s|$)/.test(name)?cart:
      psp&&/dvd-umd-shell/.test(name)?umdHousing:psp&&/dvd-umd-window/.test(name)?umdWindow:
      /dvd-disc(?:\s|$)/.test(name)?(/underside/.test(name)?silver:disc):/disc-edge/.test(name)?silver:/hub|clip|cradle/.test(name)?raised:plastic;
    const ribbed=longbox&&/game-box-jewel-inset|jewel-lid-rail/.test(name);
    if(longbox){
      const transparent=/game-box-acrylic-lid|game-box-jewel-hinge-ear|jewel-lid-rail|jewel-bearing|jewel-pin/.test(name)
        ||/lid-interior/.test(name);
      if(transparent)mat=ribbed?ribbedAcrylic:acrylic;
      else if(ribbed)mat=ribbedPlastic;
    }
    // The shared SVG contains 32 ridges per tile. Keep their physical pitch
    // at 0.85 mm instead of repeating the entire tile for every single ridge.
    batch(face,faceGeometry(face,{style,...(ribbed?{uv:(x,y)=>[x/(mat===ribbedAcrylic?32*.85:.95),y/face.height]}:{})}),mat,/manual-clip|manual-pressure|manual-frame/.test(name)?'clips':'body');
  }
  const clipMeshes=[];
  const compiled=template?.meshes||[...batches].map(([key,entry])=>{
    const geometry=mergeGeometries(entry.geometries);entry.geometries.forEach(g=>g.dispose());
    return {key,geometry,material:entry.material.name,part:entry.part,category:entry.category,count:entry.geometries.length};
  });
  const byName=new Map(surfaceMaterials.map(mat=>[mat.name,mat]));
  for(const entry of compiled) {
    const geometry=entry.geometry.clone();
    if(entry.material==='Case Acrylic')maskClearPanels(geometry,[-1,1].map(side=>
      new THREE.Box3(new THREE.Vector3(side*w/2-1.5,-h/2-1.5,-d/2-1.5),new THREE.Vector3(side*w/2+1.5,h/2+1.5,d/2))));
    const mesh=new THREE.Mesh(geometry,byName.get(entry.material));mesh.name=entry.key;parts[entry.part].add(mesh);
    if(mesh.material===silver)prepareDiscReverse(geometry);
    mesh.userData.sourceFaces=entry.count;
    if(entry.category==='clips')mesh.userData.caseClip=true;
    if(entry.category==='clips')clipMeshes.push(mesh);
  }
  const shadowReceivers=[],shadowCasters=[],receiverMaterial=clear?new THREE.ShadowMaterial({color:0x17202b,opacity:.12,depthWrite:false,side:THREE.FrontSide}):null;
  const casterMaterial=clear?new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false,side:THREE.DoubleSide}):null;
  if(clear)for(const entry of compiled.filter(entry=>entry.material==='Cover Outside')) {
    // The inside is the reverse of the same folded sheet: invert U, winding
    // and normals, and offset toward the cavity. Printed text stays readable.
    const geometry=entry.geometry.clone(),p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv;
    for(let i=0;i<p.count;i++){
      p.setXYZ(i,p.getX(i)-n.getX(i)*.20,p.getY(i)-n.getY(i)*.20,p.getZ(i)-n.getZ(i)*.20);
      n.setXYZ(i,-n.getX(i),-n.getY(i),-n.getZ(i));uv.setX(i,1-uv.getX(i));
    }
    for(const attr of Object.values(geometry.attributes))for(let i=0;i<attr.count;i+=3)for(let c=0;c<attr.itemSize;c++){
      const a=(i+1)*attr.itemSize+c,b=(i+2)*attr.itemSize+c,t=attr.array[a];attr.array[a]=attr.array[b];attr.array[b]=t;
    }
    const mesh=new THREE.Mesh(geometry,inside);mesh.name='Inside Paper '+entry.part;parts[entry.part].add(mesh);
    const shade=geometry.clone(),sp=shade.attributes.position;
    for(let i=0;i<sp.count;i++)sp.setXYZ(i,sp.getX(i)+n.getX(i)*.03,sp.getY(i)+n.getY(i)*.03,sp.getZ(i)+n.getZ(i)*.03);
    const receiver=new THREE.Mesh(shade,receiverMaterial);receiver.name='Inlay Contact Shadows';receiver.receiveShadow=true;
    receiver.userData.caseShadow='receiver';
    parts[entry.part].add(receiver);shadowReceivers.push(receiver);
  }
  if(clear)for(const part of ['tray','lid']) {
    const geometry=mergeGeometries(compiled.filter(entry=>entry.part===part&&['Case Plastic','Case Raised Plastic'].includes(entry.material)).map(entry=>entry.geometry));
    const walls=wallShadowGeometry(geometry,part==='tray'?-d/2+1.15:d/2-1.15,part==='lid');geometry.dispose();
    const caster=new THREE.Mesh(walls,casterMaterial);caster.name='Clear Relief Shadow Caster';caster.castShadow=true;
    caster.userData.caseShadow='caster';
    parts[part].add(caster);shadowCasters.push(caster);
  }
  if(!longbox){const lip=new THREE.Mesh(closingLip(profile),plastic);lip.name='Closing Lip';parts.tray.add(lip);}
  scene.traverse(node=>{if(node.isMesh&&!shadowReceivers.includes(node)&&!shadowCasters.includes(node)){node.castShadow=!node.material.transparent&&!node.material.isMeshBasicMaterial;
    node.receiveShadow=!!node.material.isMeshStandardMaterial;}});
  if(!template){templates.set(templateKey,{profile,paperLayout:snapshot.paperLayout,meshes:compiled,decals,sourceFaceCount:snapshot.faces.length});source.dispose();}
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
    const mesh=new THREE.Mesh(decal.geometry.clone(),mat);parts[decal.part].add(mesh);
    mesh.userData.caseDecal=decals.indexOf(decal);
    labelTextures.push(texture);labelMaterials.push(mat);labelCanvases.push(canvas);
  }
  function pose(amount) {
    const motion=globalThis.OpenCabinetDVD.motion(profile,amount);
    for(const name of ['lid','spine']){parts[name].matrix.copy(faceMatrix(motion[name](1)));parts[name].matrixAutoUpdate=false;}
    scene.updateMatrixWorld(true);
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
  pose(0);
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
  return {scene,animations:[],manifest:{dimensions:[w,h,d],spine_fraction:d/total},pose,createManual,fitManual,clearManual,update,
    exportData:{profile,paperLayout:snapshot.paperLayout,sourceFaceCount:template?.sourceFaceCount||snapshot.faces.length,
      decals:decals.map(({geometry,...info})=>info)},
    configureLighting,beforeRender,releaseLighting,selectArtwork,
    ...(longbox?{manualCover:true,onManualCover}:{}),
    ...(clear?{clearSpine:true,paperReverse}:{}),
    sourceFaceCount:template?.sourceFaceCount||snapshot.faces.length,materials:surfaceMaterials,parts,get manualSize(){return lastSize;},
    onChange(callback){changed=callback;},dispose(){disposed=true;brandObserver.disconnect();acrylicRibs?.dispose();releaseLighting();}};
}
