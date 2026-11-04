import * as THREE from '../../src/vendor/three/three.module.js';

// A shared unit cuboid covers every cardboard format. Each viewer owns only
// a small UV buffer; console dimensions are applied by the common controller.
let template;
export function build() {
  template ??= new THREE.BoxGeometry(1,1,1);
  const geometry=template.clone(),sourceUV=template.attributes.uv,uv=geometry.attributes.uv;
  const cover=new THREE.MeshBasicMaterial({name:'Cover Outside',color:0xffffff,side:THREE.FrontSide,toneMapped:false});
  const edge=new THREE.MeshPhysicalMaterial({name:'Cardboard Edges',color:0x55525a,roughness:.85,
    metalness:0,specularIntensity:.15,envMapIntensity:.2});
  const finish=new THREE.MeshPhysicalMaterial({name:'Cardboard Finish',color:0x000000,roughness:.55,
    metalness:0,clearcoat:.1,specularIntensity:.15,envMapIntensity:.15,
    transparent:true,opacity:.16,blending:THREE.AdditiveBlending,depthWrite:false});
  const mesh=new THREE.Mesh(geometry,[edge,cover,edge,edge,cover,cover]),sheen=new THREE.Mesh(geometry,finish),scene=new THREE.Group();
  mesh.name='Cardboard Box';sheen.name='Printed Cardboard Finish';scene.add(mesh,sheen);
  const manifest={dimensions:[1,1,1],spine_fraction:.046};
  let base=null,current=null,game=null,settings=null,axis='x',uvKey=null;
  function layout(profile,wrapAxis) {
    const key=[profile.width,profile.height,profile.depth,profile.spineFace,wrapAxis].join(':');
    if(key===uvKey)return;uvKey=key;
    const top=profile.spineFace==='top',panel=wrapAxis==='x'?profile.width:profile.height;
    const total=panel*2+profile.depth,face=panel/total,spine=profile.depth/total;
    // Face order in BoxGeometry: right, left, top, bottom, front, back.
    mesh.material=[edge,top?edge:cover,top?cover:edge,edge,cover,cover];
    manifest.spine_fraction=spine;
    for(let i=0;i<uv.count;i++){
      const side=Math.floor(i/4),isSpine=side===(top?2:1),front=side===4;
      let u=sourceUV.getX(i),v=1-sourceUV.getY(i);
      if(isSpine&&top)[u,v]=[v,1-u];
      if(wrapAxis==='x')uv.setXY(i,(isSpine?face+u*spine:front?face+spine+u*face:u*face),v);
      else if(isSpine)uv.setXY(i,1-v,face+u*spine);
      else uv.setXY(i,u,front?face+spine+v*face:v*face);
    }
    uv.needsUpdate=true;
  }
  function update(profile,next,resolved) {
    base=current=profile;game=next;settings=resolved;axis='x';
    edge.color.set(profile.color);layout(profile,axis);
  }
  function prepareArtwork(pictures) {
    if(!base)return;
    const image=pictures.full||pictures.cover;
    let ratio=null;
    axis=pictures.full&&(image.naturalWidth||image.width)<(image.naturalHeight||image.height)?'y':'x';
    if(image){
      ratio=(image.naturalWidth||image.width)/(image.naturalHeight||image.height);
      if(pictures.full)ratio=axis==='x'?Math.max(.1,(ratio-base.depth/base.height)/2)
        :2/Math.max(.1,1/ratio-base.depth/base.width);
    }
    const next=globalThis.OpenCabinet3D.profileFor(game.platform,ratio,game.rom_path,settings);
    const changed=next.id!==current.id||next.width!==current.width||next.height!==current.height||next.depth!==current.depth||next.spineFace!==current.spineFace;
    current=next;layout(next,axis);
    return changed?next:undefined;
  }
  return {scene,manifest,animations:[],update,prepareArtwork};
}
