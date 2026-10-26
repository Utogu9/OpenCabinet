const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('./helpers/localized-vm.cjs');

function scene(options = {}) {
  const frames = new Map(); let nextFrame = 0, observer;
  const previewUrls = [], revokedUrls = [];
  class Element {
    constructor(tag = "div") {
      this.tag = tag; this.className = ''; this.children = []; this.handlers = {}; this.dataset = {}; this.attributes = {}; this.captures = new Set();
      this.styleWrites = [];
      const style = { setProperty(name, value) { this[name] = value; } };
      this.style = options.trackStyles ? new Proxy(style, { set: (target, name, value) => { this.styleWrites.push(name); target[name] = value; return true; } }) : style;
      const classes = new Set();
      this.classList = { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) };
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; if (name === "src") this.src = ""; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    removeEventListener(name) { delete this.handlers[name]; }
    replaceChildren(...items) { this.children = items; }
    appendChild(item) { item.remove?.(); item.parentNode = this; this.children.push(item); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
    getContext() { return { drawImage() {} }; }
    getAttribute(name) { return this.attributes[name]; }
    get offsetWidth() { return 210; }
    get offsetHeight() { return 120; }
    contains(target) { return this === target || this.children.some(child => child.contains(target)); }
    getBoundingClientRect() { this.boundsReads = (this.boundsReads || 0) + 1; return this.rect || { left: 0, top: 0, width: 360, height: 320 }; }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
    focus() { this.focused = true; }
    trigger(name, extra = {}) { this.handlers[name]?.({ button: 0, pointerId: 1, clientX: 180, clientY: 160, preventDefault() {}, stopPropagation() {}, ...extra }); }
  }
  const context = vm.createContext({
    AbortController,
    URL: { createObjectURL(blob) { const url = `blob:preview-${previewUrls.length}`; previewUrls.push({url,blob}); return url; }, revokeObjectURL(url) { revokedUrls.push(url); } },
    matchMedia: () => ({ matches: !!options.reducedMotion }),
    document: { createElement: (tag) => new Element(tag) },
    ResizeObserver: class { constructor(callback) { this.callback = callback; observer = this; } observe() {} disconnect() { this.disconnected = true; } },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/dvd-case.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/pdf-manual.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/image-fallbacks.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/game-box.js"), "utf8"), context);
  const host = new Element(); const profiles = [], openingStates = [];
  const manualStates = [];
  const viewer = context.OpenCabinet3D.createViewer(host, { imageSource: (source) => `asset:${source}`, onProfile: (profile) => profiles.push(profile), onOpenState: state => openingStates.push(state),
    getCoverPreview: options.getCoverPreview, loadCoverPreview: options.loadCoverPreview, loadManual: options.loadManual, onManualState: state => manualStates.push(state), onManualCoverChange: options.onManualCoverChange,
    onManualActivate: options.onManualActivate, onManualDeactivate: options.onManualDeactivate });
  const descendants = node => (node?.children || []).flatMap(child => child instanceof Element ? [child, ...descendants(child)] : []);
  return { loadCover() { const image = descendants(host.children[0]).find(e => e.dataset.face === 'front')?.children[1]; if (image) { image.naturalWidth ||= profiles.at(-1).width; image.naturalHeight ||= profiles.at(-1).height; image.onload?.(); } }, elements: () => descendants(host.children[0]), api: context.OpenCabinet3D, dvd: context.OpenCabinetDVD, host, viewer, frames, profiles, openingStates, manualStates, observer,
    flush(time) { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(time)); },
    model: () => host.children[0], previewUrls, revokedUrls,
    face: (name) => descendants(host.children[0]).find((face) => face.dataset.face === name),
  };
}
const game = { id: 1, title: "A <literal> title", platform: "PS2" };
const artwork = [{ kind: "cover", path: "front.png" }, { kind: "back_cover", path: "back.png" }, { kind: "spine", path: "spine.png" }];
const discFace = app => app.elements().find(face => face.className === 'game-box-face game-box-dvd-disc');

test('The viewer applies per-game box settings before textures load and switches back to platform settings',()=>{
  const app=scene();const defaults={base:{color:'#0000ff',model:'dvd'},regions:{europe:{color:'#123456'}}};
  app.viewer.update({...game,rom_path:'Game (Europe).iso',box_3d:{base:{color:'#cc0011'}}},artwork,defaults);
  assert.equal(app.profiles.at(-1).color,'#cc0011');
  app.loadCover();assert.equal(app.profiles.at(-1).color,'#cc0011');
  app.viewer.update({...game,rom_path:'Game (Europe).iso',box_3d:null},artwork,defaults);
  assert.equal(app.profiles.at(-1).color,'#123456');
});

test('Full cover takes priority and folds use UV windows into the same original image',()=>{
  const app=scene();const full={kind:'box_full',path:'complete.png'};
  const source=[...artwork,full];app.viewer.update(game,source);
  const front=app.face('front').children.find(e=>e.tag==='img');
  assert.equal(front.src,'asset:complete.png');
  front.naturalWidth=2840;front.naturalHeight=1900;front.onload();
  const model=app.model();assert.equal(model.dataset.fullCover,'ready');
  for(const kind of ['cover','back_cover','spine'])assert.equal(model.style[`--box-texture-${kind}`],'url("asset:complete.png")');
  assert.equal(model.style['--box-texture-position-cover'],'100% 0%');
  assert.equal(model.style['--box-texture-position-back_cover'],'0% 0%');
  assert.equal(model.style['--box-texture-position-spine'],'50% 0%');
  assert.ok(app.elements().filter(e=>e.className==='game-box-fold-ink').every(e=>e.style.backgroundSize.includes('--box-texture-size-')));
  assert.ok(app.face('front').children.some(e=>e.className==='game-box-wrap-texture'&&e.classList.contains('loaded')));
  assert.equal(source.length,4);assert.equal(source.at(-1).kind,'box_full');
  const previous=app.model().children[0];
  app.viewer.update(game,[...artwork,{...full,path:'new-complete.png'}]);
  assert.notEqual(app.model().children[0],previous);
  assert.equal(app.face('front').children.find(e=>e.tag==='img').src,'asset:new-complete.png');
  app.viewer.clear();assert.equal(app.model().dataset.fullCover,undefined);
});

test('Broken full covers fall back to individual images and late failures cannot replace another game',()=>{
  const app=scene();app.viewer.update(game,[...artwork,{kind:'box_full',path:'missing.png'}]);
  const broken=app.face('front').children.find(e=>e.tag==='img');
  const lateFailure=broken.onerror;broken.onerror();
  assert.equal(app.face('front').children.find(e=>e.tag==='img').src,'asset:front.png');
  app.viewer.update({...game,id:2},[{kind:'box_full',path:'other.png'}]);
  lateFailure();
  assert.equal(app.face('front').children.find(e=>e.tag==='img').src,'asset:other.png');
});

test('Cached full covers wrap every face and fold immediately, retaining the same UVs when the original replaces them',()=>{
  const bitmap={width:1200,height:800,previewBlob:{type:'image/webp'}};
  const app=scene({getCoverPreview:path=>path==='complete.png'?bitmap:null});
  app.viewer.update(game,[...artwork,{kind:'box_full',path:'complete.png'}]);
  assert.equal(app.model().dataset.fullCover,'preview');
  const positions=['cover','back_cover','spine'].map(kind=>app.model().style[`--box-texture-position-${kind}`]);
  for(const kind of ['cover','back_cover','spine'])assert.equal(app.model().style[`--box-texture-${kind}`],'url("blob:preview-0")');
  assert.equal(app.elements().filter(element=>element.className==='game-box-wrap-texture'&&element.classList.contains('loaded')).length,3);
  const original=app.face('front').children.find(element=>element.tag==='img');
  original.naturalWidth=2400;original.naturalHeight=1600;original.onload();
  assert.equal(app.model().dataset.fullCover,'ready');
  assert.deepEqual(['cover','back_cover','spine'].map(kind=>app.model().style[`--box-texture-position-${kind}`]),positions);
  assert.equal(app.model().style['--box-texture-cover'],'url("asset:complete.png")');
  assert.deepEqual(app.revokedUrls,['blob:preview-0']);
  assert.equal(bitmap.width,1200,'The shared cached bitmap remains intact');
});

test('A full cover can be loaded from disk on demand, with stale results ignored after changing games',async()=>{
  const requests=[];
  const app=scene({loadCoverPreview:(path,signal)=>new Promise(resolve=>requests.push({path,signal,resolve}))});
  app.viewer.update(game,[{kind:'box_full',path:'first.png'}]);
  assert.equal(requests[0].path,'first.png');
  requests[0].resolve({width:800,height:1200,previewBlob:{}});await turn();
  assert.equal(app.model().dataset.fullCover,'preview');
  assert.equal(app.model().style['--box-texture-position-cover'],'0% 100%');
  app.viewer.update({...game,id:2},[{kind:'box_full',path:'second.png'}]);
  assert.equal(requests[0].signal.aborted,true);assert.deepEqual(app.revokedUrls,['blob:preview-0']);
  app.viewer.update({...game,id:3},[]);
  requests[1].resolve({width:1200,height:800,previewBlob:{}});await turn();
  assert.equal(app.previewUrls.length,1);assert.equal(app.model().dataset.fullCover,undefined);
});

test('Late full-cover previews cannot overwrite a decoded original, and clear releases preview URLs',async()=>{
  let finish;
  const app=scene({loadCoverPreview:()=>new Promise(resolve=>finish=resolve)});
  app.viewer.update(game,[{kind:'box_full',path:'full.png'}]);
  const original=app.face('front').children.find(element=>element.tag==='img');
  original.naturalWidth=2400;original.naturalHeight=1600;original.onload();
  finish({width:1200,height:800,previewBlob:{}});await turn();
  assert.equal(app.previewUrls.length,0);assert.equal(app.model().dataset.fullCover,'ready');
  const cached=scene({getCoverPreview:()=>({width:1200,height:800,previewBlob:{}})});
  cached.viewer.update(game,[{kind:'box_full',path:'full.png'}]);cached.viewer.clear();
  assert.deepEqual(cached.revokedUrls,['blob:preview-0']);
});

test('3D case uses fanart for missing covers and disc, then switches to newly supplied originals',()=>{
  const app=scene();
  const images=[{kind:'fanart_cover',path:'fan-front.png'},{kind:'fanart_back_cover',path:'fan-back.png'},{kind:'fanart_disc',path:'fan-disc.png'}];
  app.viewer.update(game,images);
  assert.ok(app.elements().some(e=>e.src==='asset:fan-front.png'));
  app.loadCover();
  assert.ok(app.elements().some(e=>e.src==='asset:fan-back.png'));
  app.viewer.update(game,[...images,{kind:'cover',path:'normal.png'}]);
  assert.ok(app.elements().some(e=>e.src==='asset:normal.png'));
  assert.ok(images.every(e=>e.kind.startsWith('fanart_')));
});

test('Both open CD halves rest on the same exterior support plane, independently of the raised tray',()=>{
  for(const [platform,rom_path] of [['PS1','Game (USA).chd'],['PS1','Game (Europe).chd'],['Dreamcast','Game.chd'],['Sega CD','Game.chd'],['Sega Saturn','Game.chd']]) {
    const app=scene(),profile=app.api.profileFor(platform,null,rom_path),faces=[];
    app.dvd.build({profile,game:{...game,platform,rom_path},images:[],addFace:f=>faces.push(f),imageSource:v=>v,trackTexture(){},isCurrent:()=>true,schedule(){}});
    const xyz=f=>f.transform(1).match(/translate3d\(([^p]+)px,([^p]+)px,([^p]+)px/).slice(1).map(Number);
    const {z}=app.dvd.jewelPivot(profile),movement=app.dvd.motion(profile,1);
    assert.equal(movement.angle,180);
    const lidLip=profile.depth/2+.12;
    const rearOutside=-profile.depth/2;
    assert.ok(Math.abs((2*z-lidLip)-rearOutside)<1e-8,platform+' outside faces rest on the same plane');
    const tray=faces.find(f=>f.element.className==='game-box-face game-box-dvd-interior');
    assert.ok(xyz(tray)[2]>rearOutside+5,'the support plane is not the raised disc tray');
    assert.ok(Math.abs(app.dvd.motion(profile,0).lid(1).match(/rotateY\(([^d]+)deg/)[1])===0);
  }
});

test('Longbox end skirts close down to the rear plate without protruding above the tray floor',()=>{
  for(const platform of ['Sega CD','Sega Saturn']) {
    const app=scene(),profile=app.api.profileFor(platform),faces=[];
    app.dvd.build({profile,game:{...game,platform},images:[],addFace:f=>faces.push(f),imageSource:v=>v,trackTexture(){},isCurrent:()=>true,schedule(){}});
    const xyz=f=>f.transform(1).match(/translate3d\(([^p]+)px,([^p]+)px,([^p]+)px/).slice(1).map(Number);
    const top=faces.find(f=>f.element.className==='game-box-face game-box-dvd-interior');
    const back=faces.find(f=>f.element.className.endsWith('jewel-tray-back'));
    assert.ok(Math.abs(xyz(back)[2]-(-profile.depth/2+.06))<1e-8,'the black moulding reaches the rear cover, not an elevated intermediate plate');
    const skirts=faces.filter(f=>f.element.className.endsWith('jewel-tray-skirt'));
    const cavity=faces.filter(f=>f.element.className.endsWith('jewel-well-wall'));
    assert.equal(cavity.length,96,'the circular cutout has black depth walls, including behind finger gaps');
    const floor=faces.find(f=>f.element.className.endsWith('dvd-disc-well'));
    assert.ok(cavity.every(f=>Math.abs(xyz(f)[2]+f.height/2-xyz(top)[2])<1e-8&&Math.abs(xyz(f)[2]-f.height/2-xyz(floor)[2])<1e-8));
    assert.equal(skirts.length,12,'both ends have six solid faces');
    const side=faces.filter(f=>f.element.className.endsWith('jewel-tray-side'));
    for(const f of [...skirts,...side]) {
      const position=xyz(f),halfDepth=Math.abs(f.normal[0])?f.width/2:Math.abs(f.normal[1])?f.height/2:0;
      assert.ok(position[2]+halfDepth<=xyz(top)[2]+1e-8,'all closures extend down from the tray floor');
      assert.ok(position[2]-halfDepth>=xyz(back)[2]-1e-8);
    }
    for(const sy of [-1,1]) {
      const end=skirts.filter(f=>Math.sign(xyz(f)[1])===sy);
      assert.ok(end.some(f=>f.normal[2]===1&&Math.abs(xyz(f)[2]-xyz(top)[2])<1e-8));
      assert.ok(end.some(f=>f.normal[2]===-1&&Math.abs(xyz(f)[2]-xyz(back)[2])<1e-8));
      assert.ok(end.some(f=>f.normal[1]===sy&&Math.abs(xyz(f)[1]-sy*profile.height/2)<1e-8));
      assert.ok(end.every(f=>f.part==='tray'));
    }
  }
});

test('Genesis tangent planes are not cropped a second time at the rounded opening joins',()=>{
  const app=scene();app.viewer.update({...game,platform:'Genesis'},artwork);app.flush();
  assert.equal(app.face('right').style.clipPath,'none');
  assert.equal(app.face('top').style.clipPath,'inset(0 0 0 var(--box-corner-tl))');
  assert.equal(app.face('bottom').style.clipPath,'inset(0 0 0 var(--box-corner-bl))');
  app.viewer.dispose();
});

test('Security dividers separate the full strip on both halves of GameCube, DS and 3DS',()=>{
  for(const platform of ['Nintendo GameCube','Nintendo DS','Nintendo 3DS']) {
    const app=scene(),profile=app.api.profileFor(platform),faces=[];
    app.dvd.build({profile,game:{...game,platform},images:[],addFace:f=>faces.push(f),imageSource:v=>v,trackTexture(){},isCurrent:()=>true,schedule(){}});
    for(const part of ['lid','tray']) {
      const divider=faces.filter(f=>f.part===part&&f.element.className.endsWith('security-divider'));
      assert.equal(divider.length,6,'each divider is a closed solid');
      assert.ok(divider.some(f=>f.height===profile.height-8));
      assert.ok(divider.every(f=>+f.transform(1).match(/translate3d\(([^p]+)px/)[1]<profile.width/2-9),'divider stays inside the security strip');
    }
  }
});

test('Security catches are trimmed only where they intersect the opening, retaining closed roots and end clips',()=>{
  for(const [platform,region] of [['Nintendo GameCube','USA'],['Nintendo GameCube','Japan'],['Nintendo DS','USA'],['Nintendo DS','Europe'],['Nintendo 3DS','USA']]) {
    const app=scene(),profile=app.api.profileFor(platform,null,`Game (${region}).rom`),faces=[];
    app.dvd.build({profile,game:{...game,platform},images:[],addFace:f=>faces.push(f),imageSource:v=>v,trackTexture(){},isCurrent:()=>true,schedule(){}});
    const opening=app.dvd.openingChannel(profile),xLimit=profile.width/2-opening.intrusion-.8-.06;
    const yLimit=profile.height*opening.length/2+.06;
    const zLimit=profile.depth/4+.075-(profile.depth/2-.15)*.12+.8+.06;
    for(const part of ['lid','tray']) {
      const catches=[];
      for(const name of ['security-channel','security-catch']) {
        const pieces=faces.filter(f=>f.part===part&&f.element.className.endsWith(name));
        assert.equal(pieces.length%6,0,'trimmed pieces remain closed solids');
        for(let i=0;i<pieces.length;i+=6) {
          const points=pieces.slice(i,i+6).map(f=>f.transform(1).match(/translate3d\(([^p]+)px,([^p]+)px,([^p]+)px\)/).slice(1).map(Number));
          const lo=[0,1,2].map(a=>Math.min(...points.map(p=>p[a]))),hi=[0,1,2].map(a=>Math.max(...points.map(p=>p[a])));
          const overlap=hi[0]>xLimit+1e-8 && hi[1]>-yLimit+1e-8 && lo[1]<yLimit-1e-8 && hi[2]>-zLimit+1e-8 && lo[2]<zLimit-1e-8;
          assert.equal(overlap,false,`${platform} ${region} ${part}: no clip enters the notch`);
          assert.ok(hi.every((v,a)=>v>lo[a]),'no degenerate fragments');
          if(name==='security-catch')catches.push({lo,hi});
        }
      }
      const central=catches.filter(b=>b.lo[1]<0&&b.hi[1]>0);
      assert.ok(central.length,'central catch is retained');
      assert.ok(central.some(b=>b.hi[0]-b.lo[0]<4-1e-8),'only the interfering end is shortened');
      assert.ok(catches.some(b=>b.lo[1]>yLimit&&Math.abs(b.hi[0]-b.lo[0]-4)<1e-8),'unaffected end catch keeps its full width');
    }
    app.viewer.dispose();
  }
});

test('Longbox trays reach the printed right spine without raised end rails or exposed paper margins',()=>{
  for(const platform of ['Sega CD','Sega Saturn']) {
    const app=scene(),profile=app.api.profileFor(platform),faces=[];
    app.dvd.build({profile,game:{...game,platform},images:[],addFace:f=>faces.push(f),imageSource:v=>v,trackTexture(){},isCurrent:()=>true,schedule(){}});
    const panel=faces.find(f=>f.element.className==='game-box-face game-box-dvd-interior');
    assert.equal(panel.height,profile.height);
    const x=+panel.transform(1).match(/translate3d\(([^p]+)px/)[1];
    assert.equal(x+panel.width/2,profile.width/2,'flat tray reaches the right edge');
    assert.equal(faces.some(f=>f.element.className.includes('jewel-tray-end')),false);
    const side=faces.find(f=>f.element.className.endsWith('jewel-tray-side')&&f.normal[0]===1);
    assert.equal(+side.transform(1).match(/translate3d\(([^p]+)px/)[1],profile.width/2-.25,'right wall stays behind the printed spine plane');
    const lining=faces.find(f=>f.element.className.endsWith('jewel-spine-liner'));
    assert.equal(lining.normal[0],-1);assert.equal(lining.part,'tray');
    assert.equal(lining.width,profile.depth-1.6,'the black inner lining covers the printed spine without a thick raised rail');
    assert.equal(+lining.transform(1).match(/translate3d\(([^p]+)px/)[1],profile.width/2-.12,'lining is inside the paper reverse, separated from the exterior art');
  }
});

test('Genesis has inward spine material while closed and a rounded recessed opening independent of its thin flange',()=>{
  const app=scene();app.viewer.update({...game,platform:'Sega Genesis'},artwork);app.flush();
  const elements=app.elements(),inner=elements.find(e=>e.className.endsWith('genesis-spine-inner'));
  assert.equal(inner.style.display,'');assert.equal(inner.parentNode.dataset.part,'spine');
  const scale=+app.model().style['--box-scale'],curves=elements.filter(e=>e.className.endsWith('genesis-opening-curve'));
  assert.equal(curves.length,48);
  const radius=parseFloat(curves[0].style.width)/scale/(2*Math.sin(Math.PI/96));
  assert.ok(Math.abs(radius-3.2)<1e-8,'body rounds at 3.2 mm without changing the outer flange');
  const halfRight=parseFloat(app.face('right').style.height)/(2*scale);
  assert.equal(halfRight,95-3.8-radius,'flat opening ends exactly where the quarter-round starts');
  app.viewer.setOpen(true,false);app.flush();assert.equal(inner.style.display,'');app.viewer.dispose();
});

test('DS and 3DS build cartridge interiors lazily, retain security catches and release their textures',()=>{
  for(const [platform,rom_path] of [['Nintendo DS','Game (USA).nds'],['Nintendo DS','Game (Europe).nds'],['Nintendo 3DS','Game.3ds']]) {
    const app=scene();app.viewer.update({...game,platform,rom_path},[...artwork,{kind:'cart_label',path:'card.png'}]);app.flush();
    assert.equal(app.viewer.canOpen,true);
    assert.equal(app.elements().some(e=>e.dataset.medium),false,'closed cases do not build cartridge textures');
    app.viewer.setOpen(true,false);app.flush();
    const elements=app.elements(),card=elements.find(e=>e.dataset.medium=== (platform==='Nintendo 3DS'?'3ds-card':'ds-card'));
    assert.ok(card,platform);assert.equal(discFace(app),undefined,'cartridges do not get optical discs');
    assert.ok(elements.some(e=>e.className.includes('manual-root')));
    for(const part of ['lid','tray'])assert.ok(elements.some(e=>e.className.includes('security-catch')&&e.parentNode.dataset.part===part));
    const image=card.children.find(e=>e.tag==='img');assert.ok(image);
    assert.equal(image.src,'asset:card.png');assert.equal(app.frames.size,0);
    const cavities=elements.filter(e=>e.dataset.recess==='3ds');
    assert.equal(cavities.length,platform==='Nintendo 3DS'?20:0);
    if(cavities.length) {
      assert.ok(cavities.every(e=>e.style.borderRadius));
      for(const part of ['lid','tray']) {
        const floor=elements.find(e=>e.className.startsWith('game-box-face game-box-dvd-interior')&&e.parentNode.dataset.part===part);
        assert.ok(decodeURIComponent(floor.style.maskImage).includes('width="19"'),'both floors retain the rounded grid cutouts');
      }
    }
    app.viewer.dispose();assert.equal(image.src,'');
  }
});

test('GameCube uses the complete brand, labelled memory holder and security catches without a hinge ridge or PUSH text',()=>{
  const app=scene();app.viewer.update({...game,platform:'Nintendo GameCube'},artwork);app.viewer.setOpen(true,false);app.flush();
  const elements=app.elements();assert.ok(elements.some(e=>e.className==='game-box-gamecube-logo'));
  assert.equal(elements.find(e=>e.className.includes('gc-memory-caption')).textContent,'Optional Memory Card Storage');
  assert.equal(elements.some(e=>e.className.includes('hinge-ridge')),false);
  assert.equal(elements.find(e=>e.className==='game-box-face game-box-dvd-hub').textContent,'');
  assert.ok(elements.some(e=>e.className.includes('security-catch')));app.viewer.dispose();
});

test('Jewel lids grip the complete fixed column, exclude acrylic ribbing and open parallel to the rear',()=>{
  for(const platform of ['PS1','Dreamcast','Sega CD','Sega Saturn']) {
    const app=scene();app.viewer.update({...game,platform},artwork);app.flush();
    const profile=app.profiles.at(-1),scale=+app.model().style['--box-scale'];
    if(['PS1','Dreamcast'].includes(platform))assert.ok(Math.abs(parseFloat(app.face('top').style.width)/scale-(profile.width-12))<1e-8);
    const ears=app.elements().filter(e=>e.className==='game-box-face game-box-jewel-hinge-ear');
    assert.equal(ears.length,12);assert.ok(ears.every(e=>e.parentNode.dataset.part==='lid'&&e.style.display===''));
    app.viewer.setOpen(true,false);app.flush();assert.match(app.face('front').parentNode.style.transform,/rotateY\(-180deg\)/);
    if(platform.startsWith('Sega')) {
      assert.equal(app.elements().filter(e=>e.className==='game-box-face game-box-dvd-jewel-tray-end').length,0);
      assert.equal(app.elements().filter(e=>e.className==='game-box-face game-box-dvd-jewel-tray-side').length,6);
    }
    app.viewer.dispose();
  }
});

test('Genesis aligns all sleeve heights and closes recessed opening corners with visible inner flange faces',()=>{
  const app=scene();app.viewer.update({...game,platform:'Sega Genesis'},artwork);app.flush();
  const elements=app.elements(),scale=+app.model().style['--box-scale'];
  assert.equal(app.face('front').children[1].style.height,app.face('left').children[1].style.height);
  assert.ok(Math.abs(parseFloat(app.face('right').style.height)/scale-176)<1e-8);
  assert.equal(elements.filter(e=>e.className.includes('game-box-grab-lip-inner')).length,2);
  assert.equal(elements.filter(e=>e.className.includes('game-box-genesis-opening-curve')).length,48);
  app.viewer.setOpen(true,false);app.flush();
  const mark=app.elements().find(e=>e.className==='game-box-sega-mark');
  assert.ok(Math.abs(parseFloat(mark.parentNode.style.width)/(+app.model().style['--box-scale'])-50)<1e-8);app.viewer.dispose();
});

test('CD disc, well and hub share the center of the usable tray and longboxes retain a black insert',()=>{
  for(const platform of ['PS1','Dreamcast','Sega CD','Sega Saturn']) {
    const app=scene();app.viewer.update({...game,platform},artwork);app.viewer.setOpen(true,false);app.flush();
    const scale=Number(app.model().style['--box-scale']);
    for(const name of ['disc','disc-well','hub']) {
      const face=app.elements().find(e=>e.className==='game-box-face game-box-dvd-'+name);
      const x=Number(face.style.transform.match(/translate3d\(([^p]+)px/)[1])/scale;
      assert.ok(Math.abs(x-6)<1e-8,platform+' centers '+name+' beside the fixed column');
    }
    const tray=app.elements().find(e=>e.className==='game-box-face game-box-dvd-interior');
    const tall=platform==='Sega CD'||platform==='Sega Saturn';
    assert.equal(tray.style.backgroundColor,tall?'var(--box-jewel-tray)':'var(--box-shell)');
    if(tall)assert.equal(app.profiles.at(-1).depth,21);
    app.viewer.dispose();
  }
});

test('CD front covers clear the fixed column throughout opening, with smooth ears or extended ribbed rails',()=>{
  for(const platform of ['PS1','Dreamcast','Sega Saturn']) {
    const app=scene(),profile=app.api.profileFor(platform),pivot=app.dvd.jewelPivot(profile),faces=[];
    app.dvd.build({profile,game:{...game,platform},images:[],addFace:f=>faces.push(f),imageSource:v=>v,trackTexture(){},isCurrent:()=>true,schedule(){}});
    const tall=profile.id==='longbox';
    app.viewer.update({...game,platform},artwork);app.flush();
    assert.equal(app.elements().filter(e=>e.className==='game-box-face game-box-jewel-hinge-ear').length,12,'full-depth ears exist before opening');
    assert.equal(faces.filter(f=>f.element.dataset.pivot==='jewel').length,2);
    for(const f of faces.filter(f=>f.element.className.includes('jewel-lid-rail')&&f.normal[2]===1)) {
      const xyz=f.transform(1).match(/translate3d\(([^p]+)px,([^p]+)px,([^p]+)px/).slice(1).map(Number);
      assert.ok(Math.abs(xyz[1])-f.height/2>profile.height/2,'the rail clears the upper/lower end of the fixed column');
      assert.ok(tall ? xyz[0]-f.width/2< -profile.width/2+12 : xyz[0]-f.width/2> -profile.width/2+12);
    }
    for(const amount of [.01,.05,.15,.3,.5,.75,1]) {
      const a=amount*180*Math.PI/180;
      for(const x of [-profile.width/2+12,0,profile.width/2]) {
        const dx=x-pivot.x,dz=profile.depth/2+.12-pivot.z;
        const xx=pivot.x+dx*Math.cos(a)-dz*Math.sin(a),zz=pivot.z+dx*Math.sin(a)+dz*Math.cos(a);
        assert.ok(!(xx> -profile.width/2&&xx< -profile.width/2+12&&zz> -profile.depth/2&&zz<profile.depth/2+.05),'opening cover never intersects its fixed column');
      }
    }
    app.viewer.dispose();
  }
});

test('Open sleeve joins retain their curved artwork, have solid backing, and the spine rib is a fine curved line',()=>{
  const app=scene();app.viewer.update(game,artwork);app.viewer.setOpen(true,false);app.flush();
  const folds=app.elements().filter(e=>e.className==='game-box-face game-box-fold');
  assert.equal(folds.length,32);assert.ok(folds.every(e=>e.style.display===''&&['lid','tray'].includes(e.parentNode.dataset.part)));
  const lining=app.elements().filter(e=>e.className==='game-box-face game-box-fold-lining');
  assert.equal(lining.length,32);assert.ok(lining.every(e=>e.style.display===''));
  assert.equal(app.elements().filter(e=>e.className==='game-box-face game-box-dvd-shell-joint').length,2);
  const rib=app.elements().filter(e=>e.className==='game-box-face game-box-dvd-hinge-ridge'&&e.style.clipPath);
  assert.equal(rib.length,2,'rounded cross-section has closed caps');
  const scale=Number(app.model().style['--box-scale']);
  assert.ok(rib.every(e=>parseFloat(e.style.width)/scale<.31&&parseFloat(e.style.height)/scale<.61));
  app.viewer.dispose();
});

test('Genesis has a three-sided flange with thin curved edges; Xbox hubs have no PUSH text',()=>{
  const app=scene();app.viewer.update({...game,platform:'Sega Genesis'},artwork);app.flush();
  const scale=Number(app.model().style['--box-scale']),lips=app.elements().filter(e=>e.className.includes('game-box-grab-lip'));
  assert.equal(lips.length,4);
  assert.ok(lips.every(e=>Math.abs(parseFloat(e.style.width)/scale-135)<1e-8&&Math.abs(parseFloat(e.style.height)/scale-190)<1e-8));
  const curves=app.elements().filter(e=>e.className==='game-box-face game-box-corner');
  assert.equal(curves.length,192);assert.ok(curves.every(e=>parseFloat(e.style.height)/scale<.7),'curves do not bridge the full depth across the recessed opening');
  for(const platform of ['Xbox','Xbox 360']) {
    app.viewer.update({...game,platform},artwork);app.viewer.setOpen(true,false);app.flush();
    assert.equal(app.elements().find(e=>e.className==='game-box-face game-box-dvd-hub').textContent,'');
  }
  app.viewer.dispose();
});

test('Console interiors retain physical disc sizes, centered wells and finger access', () => {
  for (const [platform, diameter, offset] of [['PS2',120,18.05],['Wii',120,0],['Wii U',120,0],['Xbox',120,0],['Xbox 360',120,0],['PS3',120,7],['PS4',120,0],['PS5',120,0],['GameCube',80,21.85],['PSP',60,0],['Sega Saturn',120,29.26]]) {
    const app=scene(), faces=[]; const profile=app.api.profileFor(platform);
    const interior=app.dvd.build({profile,game:{...game,platform},images:[],addFace:face=>faces.push(face),imageSource:v=>v,trackTexture(){},isCurrent:()=>true,schedule(){}});
    const disc=faces.find(f=>f.element.className==='game-box-face game-box-dvd-disc'||f.element.className.endsWith('disc umd-disc'));
    assert.equal(disc.width,diameter,platform);
    const position=disc.transform(1).match(/translate3d\(([^p]+)px,([^p]+)px,([^p]+)px\)/).slice(1).map(Number);
    assert.ok(Math.abs(position[1]-offset)<.001,platform+' disc placement');
    if(platform==='PSP')assert.ok(faces.some(f=>f.element.className.includes('umd-cradle')));
    else {
      assert.equal(faces.find(f=>f.element.className.endsWith('dvd-disc-cradle')).element.dataset.fingerGaps,platform==='Wii U'?'3':'4',platform);
      assert.ok(faces.filter(f=>f.element.className.endsWith('dvd-disc-cradle-wall')).length>100,platform+' has smooth raised cradle walls');
      assert.ok(faces.some(f=>f.element.className.endsWith('dvd-disc-cradle-end')),platform+' closes the cut ends');
    }
    interior.dispose?.();app.viewer.dispose();
  }
});

test('Opening channels remain molded into both open halves and use the shell material',()=>{
  for(const platform of ['PS2','PS3','PS4','Xbox','Xbox 360','Wii','Wii U','GameCube','PSP','Nintendo Switch','Nintendo DS','Nintendo 3DS']) {
    const app=scene();app.viewer.update({...game,platform},artwork);app.flush();app.viewer.setOpen(true,false);app.flush();
    const walls=app.elements().filter(e=>e.className.includes('wall opening-channel'));
    assert.ok(walls.length>0,platform);
    for(const part of ['tray','lid'])assert.ok(walls.some(e=>e.parentNode.dataset.part===part),platform+' molded into '+part);
    assert.ok(walls.every(e=>e.style.display!=='none'&&e.style.backgroundColor==='var(--box-shell)' || e.style.display!=='none'&&e.style.backgroundColor==='var(--box-material)'),platform);
    app.viewer.setOpen(false,false);app.flush();assert.ok(walls.every(e=>e.style.display==='none'));
    app.viewer.setOpen(true,false);app.flush();assert.ok(walls.every(e=>e.style.display!=='none'));
    app.viewer.dispose();
  }
});

test('Opening channel cross sections use only right angles with a proper inner shoulder',()=>{
  for(const platform of ['PS2','PS3','PS4','Xbox','Xbox 360','Nintendo DS','PSP','Nintendo Switch']) {
    const app=scene(),faces=[],profile=app.api.profileFor(platform);
    app.dvd.build({profile,game:{...game,platform},images:[],addFace:face=>faces.push(face),imageSource:v=>v,trackTexture(){},isCurrent:()=>true,schedule(){}});
    const channel=faces.filter(f=>f.element.className.includes('wall opening-channel'));
    assert.ok(channel.length,platform);
    assert.ok(channel.every(f=>f.normal.filter(n=>Math.abs(n)>1e-8).length===1),platform+' no diagonal planes');
    assert.ok(channel.some(f=>Math.abs(f.normal[2])>.99),platform+' horizontal ledge');
    assert.ok(channel.some(f=>Math.abs(f.normal[0])>.99),platform+' vertical inner wall');
    app.viewer.dispose();
  }
});

test('Opaque shell liners expose only real holes while clear shells retain the complete paper back',()=>{
  for(const platform of ['PS2','Wii','Wii U','GameCube','Nintendo DS','Nintendo 3DS','PS3','PS4','Xbox 360']) {
    const app=scene();app.viewer.update({...game,platform},artwork);app.flush(0);app.viewer.setOpen(true,false);app.flush(100);
    const papers=app.elements().filter(e=>e.dataset.paperFace);
    assert.equal(papers.length,3,platform);
    const clear=app.profiles.at(-1).translucency<1;
    for(const paper of papers) {
      if(clear) {assert.equal(paper.dataset.paperExposure,undefined);assert.equal(paper.classList.contains('game-box-paper-occluded'),false);}
      else if(paper.dataset.paperFace==='front') {assert.equal(paper.dataset.paperExposure,'cutouts');assert.match(paper.style.maskImage,/polygon/);}
      else assert.equal(paper.classList.contains('game-box-paper-occluded'),true,platform);
    }
    // Across complete rotations, flat white liners are explicitly hidden
    // whenever their normal points away, independently of descendant images.
    const front=papers.find(p=>p.dataset.paperFace==='front');let hidden=false,shown=false;
    for(let i=0;i<24;i++){app.host.trigger('keydown',{key:'ArrowRight'});app.flush(200+i*16);hidden ||= front.classList.contains('game-box-face-culled');shown ||= !front.classList.contains('game-box-face-culled');}
    assert.ok(hidden&&shown,platform);app.viewer.dispose();
  }
});

test('Continuous rotations update plastic lighting and reflections without waiting for a pause',()=>{
  const app=scene({trackStyles:true});app.viewer.update(game,artwork);app.flush(0);app.viewer.setOpen(true,false);app.flush(100);app.flush(150);
  const surfaces=app.elements().filter(e=>e.className.startsWith('game-box-face')&&!e.className.includes('manual-cover'));
  const plastic=surfaces.filter(e=>e.className.includes('dvd-')&&!e.className.includes('disc')&&!e.className.includes('paper'));
  const lightingTargets=[...new Set(plastic.map(e=>e.parentNode.className==='game-box-light-group'?e.parentNode:e))];
  assert.ok(lightingTargets.length<plastic.length,'equivalent faces share their lighting state');
  const writes=()=>lightingTargets.reduce((n,e)=>n+e.styleWrites.filter(p=>p.startsWith('--box-shade')||p==='--box-gloss').length,0);
  // Initialize the formerly back-facing surfaces, then start a second turn.
  for(let i=0;i<24;i++){app.host.trigger('keydown',{key:'ArrowRight'});app.flush(200+i*16);}
  app.flush(700);app.flush(750);
  const before=writes(),geometry=app.face('front').style.width,reflection=app.face('front').style['--box-reflection-angle'];
  for(let i=0;i<8;i++){app.host.trigger('keydown',{key:'ArrowRight'});app.flush(800+i*16);}
  assert.ok(writes()>before,'plastic lighting updates during the continuous gesture');
  assert.notEqual(app.face('front').style['--box-reflection-angle'],reflection,'cover reflections remain live');
  app.flush(1100);app.flush(1200);
  assert.equal(app.face('front').style.width,geometry);assert.equal(app.frames.size,0);app.viewer.dispose();
});

test('Interior curves update endpoint lighting without unused midpoint or sleeve variables',()=>{
  const app=scene();app.viewer.update(game,artwork);app.flush(0);app.viewer.setOpen(true,false);app.flush(100);
  const curves=app.elements().filter(e=>e.dataset.curve&&e.className.includes('dvd-'));
  assert.ok(curves.length>100);
  const groups=[...new Set(curves.map(e=>e.parentNode))];
  assert.ok(groups.some(e=>e.style['--box-shade-start']!==undefined));
  assert.ok(groups.every(e=>e.style['--box-shade']===undefined&&e.style['--box-gloss']===undefined&&e.style['--box-gloss-start']===undefined));
  app.viewer.dispose();
});

test('Disc retaining rings end in solid straight cuts near the spine and the opening channel',()=>{
  for(const platform of ['PS2','PS3','PS4','Xbox','Xbox 360','Wii','Wii U']) {
    const app=scene(),faces=[],profile=app.api.profileFor(platform);
    app.dvd.build({profile,game:{...game,platform},images:[],addFace:face=>faces.push(face),imageSource:v=>v,trackTexture(){},isCurrent:()=>true,schedule(){}});
    const ring=faces.find(f=>f.element.className.endsWith('dvd-disc-cradle')).element;
    const left=Number(ring.dataset.cutLeft),right=Number(ring.dataset.cutRight);
    const svg=decodeURIComponent(ring.style.maskImage.split(',')[1]);
    const polygons=[...svg.matchAll(/points="([^"]+)"/g)].flatMap(m=>m[1].split(' ').map(p=>p.split(',').map(Number)));
    const outer=(120/2+5.5);
    assert.ok(polygons.every(([x])=>x-outer>=left-1e-8&&x-outer<=right+1e-8),platform);
    for(const cut of [left,right]) {
      assert.ok(polygons.some(([x])=>Math.abs(x-outer-cut)<1e-8),platform+' meets cut');
      assert.ok(faces.some(f=>f.element.className.endsWith('disc-cradle-end')&&Math.abs(f.normal[0])>.999&&Math.abs(f.normal[1])<1e-8&&Math.abs(parseFloat(f.transform(1).split('(')[1])-cut)<1e-8),platform+' closes the cut vertically');
    }
    app.viewer.dispose();
  }
});

test('DS defaults distinguish the thinner case from its thicker European variant and respect overrides',()=>{
  const app=scene();
  assert.equal(app.api.profileFor('Nintendo DS',null,'Game (USA).nds').depth,14);
  assert.equal(app.api.profileFor('Nintendo DS',null,'Game (Europe).nds').depth,20);
  assert.equal(app.api.profileFor('Nintendo DS',null,'Game (Europe).nds',{base:{model:'custom',width:135,height:122,depth:17}}).depth,17);
  app.viewer.dispose();
});

test('Transparent Blu-ray cases preserve PS3 header space while PS4 and PS5 use full-height sleeves', () => {
  for(const platform of ['PS3','PS4','PS5']) {
    const app=scene();app.viewer.update({...game,platform},artwork);app.flush();
    const profile=app.profiles.at(-1);
    assert.ok(profile.translucency<1);
    assert.equal(profile.headerHeight,platform==='PS3'?14:0);
    assert.equal(app.elements().some(e=>e.className==='game-box-bluray-header'),platform==='PS3');
    assert.equal(app.model().dataset.interior,undefined,'closed cases do not construct interiors');
    app.viewer.setOpen(true,false);app.flush();
    assert.ok(app.elements().some(e=>e.className.endsWith('dvd-cover-paper')),'reverse paper remains visible');
    assert.ok(app.elements().some(e=>e.className.includes('manual-frame')),'long manual loops');
    if(platform!=='PS3')assert.equal(profile.color,'#2263b5');
    app.viewer.dispose();
  }
});

test('Wii U, GameCube and cartridge cases have distinct fittings rather than generic DVD discs', () => {
  for(const platform of ['Wii U','GameCube','Nintendo Switch','Sega Genesis']) {
    const app=scene();app.viewer.update({...game,platform},artwork);app.viewer.setOpen(true,false);app.flush();
    const elements=app.elements();const has=term=>elements.some(e=>e.className.includes(term));
    if(platform==='Wii U') {
      assert.ok(has('wiiu-brand'));assert.ok(has('second-disc-hinge'));
      assert.ok(has('dvd-recycle-cut-edge'),'recycling opening has real walls');
      assert.ok(elements.filter(e=>e.className.includes('second-disc-hinge')).every(e=>e.dataset.casePart==='spine'));
    } else if(platform==='GameCube') {assert.ok(has('gc-memory-catch'));assert.ok(has('game-box-gamecube-logo'));}
    else {
      assert.equal(has('dvd-disc-well'),false,'cartridge holders do not receive optical discs');
      assert.equal(has('manual-clip'),false);
      if(platform==='Nintendo Switch'){assert.ok(elements.some(e=>e.dataset.medium==='switch-card'));assert.equal(has('manual-frame'),false);}
      else {assert.ok(elements.some(e=>e.dataset.medium==='genesis-cartridge'));assert.ok(has('genesis-manual-stop'));assert.ok(has('game-box-grab-lip'));}
    }
    app.viewer.dispose();
  }
});

test('Tall CD cases and square-fold boxes remain distinct configurable formats', () => {
  const app=scene();
  for(const platform of ['Sega CD','Sega Saturn']) {
    const profile=app.api.profileFor(platform);assert.equal(profile.id,'longbox');assert.equal(profile.height,209);assert.equal(app.dvd.canOpen(profile),true);
  }
  for(const platform of ['Nintendo 64','Nintendo NES','Nintendo SNES','Sega Master System']) {
    app.viewer.update({...game,platform},artwork);app.flush();
    assert.equal(app.viewer.canOpen,false,platform);
    assert.equal(app.elements().some(e=>e.className.endsWith(' game-box-corner')),false,platform+' keeps square folds');
  }
  assert.ok(app.api.formats.some(f=>f.id==='longbox'));assert.ok(app.api.formats.some(f=>f.id==='masterSystem'));app.viewer.dispose();
});

test('Open jewel cases keep both printed spines, attach ribbed rails to the lid, and separate the fixed acrylic', () => {
  for(const platform of ['PS1','Dreamcast','Sega Saturn','Sega CD']) {
    const app=scene();app.viewer.update({...game,platform},artwork);app.loadCover();app.viewer.setOpen(true,false);app.flush();
    for(const side of ['left','right']) {
      const face=app.face(side);assert.equal(face.style.display,'');assert.equal(face.parentNode.dataset.part,'tray');
      assert.equal(face.children[1].src,'asset:spine.png');
    }
    const rails=app.elements().filter(e=>e.className.includes('jewel-lid-rail'));
    assert.ok(rails.length);assert.ok(rails.every(e=>e.dataset.casePart==='lid'));
    const fixed=app.elements().filter(e=>e.className.includes('hinge-acrylic'));
    assert.equal(fixed.length,platform==='Sega Saturn'||platform==='Sega CD'?0:5);
    assert.ok(fixed.every(e=>e.parentNode.dataset.part==='tray'));
    assert.equal(app.elements().some(e=>e.className==='game-box-face game-box-dvd-hub'&&e.textContent==='PUSH'),false);
    app.viewer.dispose();
  }
});

test('Clear case walls, hinge paper and pressure tongues retain the material on every physical side', () => {
  for(const platform of ['PS3','PS4','PS5','PSP','Xbox','Xbox 360','Nintendo Switch']) {
    const app=scene();app.viewer.update({...game,platform},artwork);app.viewer.setOpen(true,false);app.flush();
    const elements=app.elements(),walls=elements.filter(e=>e.className==='game-box-face game-box-dvd-wall-inner');
    assert.ok(walls.length>80,platform+' has inward-facing corner and edge walls');
    assert.ok(walls.every(e=>e.style.backgroundColor==='var(--box-shell)'));
    assert.ok(elements.some(e=>e.className.includes('spine-paper')));
    const tongue=elements.filter(e=>e.className.includes(platform==='Nintendo Switch'?'switch-pressure':platform.startsWith('Xbox')?'manual-clip':'manual-pressure'));
    assert.ok(tongue.length,platform+' has an actual pressure tongue');
    assert.ok(tongue.every(e=>e.style.backgroundColor==='var(--box-shell)'));
    if(platform.startsWith('Xbox'))assert.equal(elements.some(e=>e.className.includes('xbox-brand')||e.className.includes('xbox360-brand')),false);
    app.viewer.dispose();
  }
});

test('Paper backs belong only to existing images, follow their exact margins and disappear with unreadable art', () => {
  for(const platform of ['PS3','PS4','Nintendo Switch','Xbox','Xbox 360']) {
    const app=scene();app.viewer.update({...game,platform},artwork.filter(image=>image.kind!=='spine'));app.viewer.setOpen(true,false);app.flush();
    assert.equal(app.elements().some(e=>e.className.includes('spine-paper')),false,platform+' does not invent a white spine from a front cover');
    app.viewer.update({...game,platform},artwork);app.viewer.setOpen(true,false);app.flush();
    const paper=app.elements().find(e=>e.dataset.paperFace==='left'),image=app.face('left').children[1];
    const profile=app.profiles.at(-1),scale=Number(app.model().style['--box-scale']);
    assert.ok(Math.abs(parseFloat(paper.style.height)/scale-profile.height*parseFloat(image.style.height)/100)<1e-8);
    assert.ok(parseFloat(paper.style.height)/scale<profile.height,'unprinted upper/lower plastic stays visible');
    if(platform==='PS3')assert.ok(profile.height-parseFloat(paper.style.height)/scale>14,'the PS3 header is not filled with white paper');
    image.onerror();assert.equal(paper.style.visibility,'hidden');
    app.viewer.dispose();
  }
});

test('The fixed CD hinge column spans the case depth, with its insert at the rear and the cover pivot at its edge', () => {
  for(const platform of ['PS1','Dreamcast','Sega Saturn','Sega CD']) {
    const app=scene();app.viewer.update({...game,platform},artwork);app.flush();
    const profile=app.profiles.at(-1),scale=Number(app.model().style['--box-scale']);
    const inset=app.elements().find(e=>e.className.endsWith('game-box-jewel-inset'));
    const z=Number(inset.style.transform.match(/translate3d\([^,]+,[^,]+,([^p]+)px\)/)[1])/scale;
    const longbox=profile.id==='longbox';
    assert.ok(longbox?z>profile.depth/2:z< -profile.depth/2+1,'insert sits at the exposed top of longboxes, or rear of the clear column');
    const column=app.elements().filter(e=>e.className.includes(longbox?'hinge-block':'hinge-acrylic'));
    assert.equal(column.length,longbox?4:5);
    assert.ok(column.some(e=>Math.abs(parseFloat(e.style.width)/scale-(profile.depth+.05))<1e-8),'column sides extend all the way from the rear shell to just below the lid');
    app.viewer.setOpen(true,false);app.flush();
    const pivot=app.dvd.jewelPivot(profile);
    assert.ok(pivot.x<-profile.width/2+12,'the pivot remains in the fixed column');
    assert.ok(Math.abs(2*pivot.z-(profile.depth/2+.12)-(-profile.depth/2))<1e-8,'the open front acrylic rests on the rear exterior support plane');
    assert.match(app.face('front').parentNode.style.transform,new RegExp('translate3d\\('+String(pivot.x*scale).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'px,'));
    assert.ok(column.every(e=>e.parentNode.dataset.part==='tray'&&e.style.display===''));
    app.viewer.dispose();
  }
});

test('Interior spine ribs and Wii U sockets follow the spine assembly with the correct clearances', () => {
  for(const platform of ['PS2','PS3','PS4','PSP','Nintendo Switch','Xbox','Xbox 360','Wii U']) {
    const app=scene();app.viewer.update({...game,platform},artwork);app.viewer.setOpen(true,false);app.flush();
    const elements=app.elements(),ridge=elements.filter(e=>e.className==='game-box-face game-box-dvd-hinge-ridge');
    assert.equal(ridge.length,platform==='Wii U'?0:13,platform);
    assert.ok(ridge.every(e=>e.dataset.casePart==='spine'));
    if(platform==='Wii U') {
      assert.ok(elements.some(e=>e.className.endsWith('dvd-recycle-relief')));
      const logo=elements.find(e=>e.className==='game-box-face game-box-dvd-brand wiiu-brand');
      assert.ok(parseFloat(logo.style.width)/Number(app.model().style['--box-scale'])<50);
      const sockets=elements.filter(e=>e.className.includes('second-disc-hinge'));
      assert.equal(sockets.length,36,'two U sockets built from three solids each');
      assert.ok(sockets.every(e=>e.dataset.casePart==='spine'));
    }
    app.viewer.dispose();
  }
});

test('PS1 and Dreamcast use the single prefetched PDF cover as their external booklet cover',async()=>{
  for(const platform of ['PS1','Dreamcast']) {
    let loads=0;const data=booklet();const activated=[];
    const app=scene({loadManual:async()=>{loads++;return data;},onManualActivate:info=>{activated.push(info);return true;}});
    data.front=new app.host.constructor('canvas');data.front.width=1200;data.front.height=1200;
    app.viewer.update({...game,platform},artwork);app.flush();await turn();app.flush();
    assert.equal(app.model().dataset.manualCover,'ready');assert.equal(app.model().dataset.interior,undefined);
    assert.equal(app.face('front').children.at(-1),data.front);
    app.viewer.setOpen(true,false);app.flush();
    const inside=app.elements().find(e=>e.className.includes('jewel-booklet-inside'));
    assert.equal(inside.dataset.manualBooklet,'true');assert.equal(inside.children.length,0,'inside sheet does not request or render more PDF pages');
    assert.equal(app.viewer.readManual(),true);assert.equal(activated[0].origin,inside);
    app.viewer.returnManual();app.viewer.zoom(.3);app.flush();assert.equal(loads,1);
    app.viewer.refreshManual();await turn();app.flush();assert.equal(loads,2);
    assert.equal(app.face('front').children.filter(e=>e.className==='game-box-jewel-manual-cover').length,1);
    app.viewer.dispose();assert.equal(data.disposed(),2);
  }
});

const turn = () => new Promise(done => setImmediate(done));
function booklet(pageCount = 32, aspectRatio = .6) {
  let disposed = 0;
  return { path: 'Guide.pdf', pageCount, aspectRatio, front: { tag: 'canvas' },
    dispose() { disposed++; }, disposed: () => disposed };
}

test('PS2 opens with a solid PDF booklet under its retaining tongues and keeps it while zooming or closing', async () => {
  const data = booklet(); let loads = 0;
  const app = scene({ loadManual: async () => { loads++; return data; } });
  app.viewer.update(game, artwork); app.flush(); assert.equal(loads, 1);
  await turn(); app.flush();
  assert.equal(app.viewer.isOpen, false);
  assert.equal(app.model().dataset.manual, 'ready');
  assert.equal(app.model().dataset.interior, undefined, 'prefetch prepares textures without constructing the closed case interior');
  app.viewer.setOpen(true, false); app.flush();
  assert.equal(loads, 1); assert.equal(app.model().dataset.manual, 'ready');
  const front = app.elements().find(face => face.className.endsWith('manual-front'));
  const back = app.elements().find(face => face.className.endsWith('manual-back'));
  assert.equal(front.dataset.casePart, 'lid'); assert.equal(front.children[0], data.front); assert.equal(back.children.length, 0);
  const scale = Number(app.model().style['--box-scale']);
  assert.ok(Math.abs(parseFloat(front.style.height) / scale - 184) < 1e-9);
  assert.ok(Math.abs(parseFloat(front.style.width) / scale - 110.4) < 1e-9);
  assert.equal(app.manualStates.at(-1).sheets, 16);
  const pages = app.elements().filter(face => face.className.includes('game-box-dvd-manual-pages'));
  assert.equal(pages.length, 3, 'the booklet has a fore-edge and two ends with visible paper layers');
  const before = front.style.transform;
  app.viewer.setOpen(false, false); app.flush(); assert.equal(front.style.display, 'none');
  app.viewer.setOpen(true, false); app.viewer.zoom(.5); app.host.rect = { width: 1600, height: 900 }; app.observer.callback(); app.flush();
  assert.equal(loads, 1); assert.equal(data.disposed(), 0); assert.notEqual(front.style.transform, before);
  assert.ok(app.elements().includes(front)); assert.equal(front.children[0], data.front);
  app.viewer.clear(); assert.equal(data.disposed(), 1); assert.equal(app.elements().length, 0);
});

test('A pending booklet from a previously selected game is cancelled and never attaches to another case', async () => {
  let finish, signal; const old = booklet();
  const app = scene({ loadManual: async (_, value) => { signal = value; return new Promise(done => { finish = done; }); } });
  app.viewer.update(game, artwork); app.viewer.setOpen(true, false); assert.equal(signal.aborted, false);
  app.viewer.update({ ...game, id: 2, platform: 'Wii' }, artwork); assert.equal(signal.aborted, true);
  finish(old); await turn(); app.viewer.setOpen(true, false); await turn(); app.flush();
  assert.equal(old.disposed(), 1); assert.equal(app.model().dataset.interior, 'wii');
  assert.equal(app.elements().some(face => face.className.includes('manual-front')), false);
});

test('Opening during manual prefetch reuses the pending load, including missing or unreadable PDFs', async () => {
  for (const result of [booklet(), null, new Error('Unreadable PDF')]) {
    let finish, loads = 0;
    const app = scene({ loadManual: async () => { loads++; return new Promise(done => { finish = done; }).then(() => {
      if (result instanceof Error) throw result; return result;
    }); } });
    app.viewer.update(game, artwork); assert.equal(loads, 1);
    app.viewer.setOpen(true, false); app.flush(); assert.equal(loads, 1);
    finish(); await turn(); app.flush();
    assert.equal(app.manualStates.at(-1).status, result instanceof Error ? 'error' : result ? 'ready' : 'none');
    app.viewer.setOpen(false, false); app.viewer.setOpen(true, false); await turn();
    assert.equal(loads, 1, 'opening must not repeat a completed or pending manual lookup');
    app.viewer.dispose();
  }
});

test('Missing or invalid PDFs keep the case usable and booklet replacement releases old geometry and textures', async () => {
  const docs = [null, new Error('Invalid PDF'), booklet(80), booklet(8,.45)]; let index = 0;
  const app = scene({ loadManual: async () => { const data = docs[index++]; if (data instanceof Error) throw data; return data; } });
  app.viewer.update(game, artwork); app.viewer.setOpen(true, false); await turn(); app.flush();
  assert.equal(app.manualStates.at(-1).status, 'none'); assert.equal(app.viewer.isOpen, true);
  app.viewer.refreshManual(); await turn(); app.flush(); assert.equal(app.manualStates.at(-1).status, 'error');
  app.viewer.refreshManual(); await turn(); app.flush(); assert.equal(app.manualStates.at(-1).status, 'ready');
  const old = app.elements().find(face => face.className.endsWith('manual-front'));
  app.viewer.refreshManual(); await turn(); app.flush();
  assert.equal(docs[2].disposed(), 1); assert.equal(app.elements().includes(old), false);
  assert.equal(app.elements().filter(face => face.className.endsWith('manual-front')).length, 1);
  assert.equal(app.manualStates.at(-1).pageCount, 8); app.viewer.dispose(); assert.equal(docs[3].disposed(), 1);
});

test('PS2 manual clips bend down and back up in Z, with constant width along Y', () => {
  const app = scene(), profile = app.api.profileFor('PS2'), faces = [];
  app.dvd.build({ profile, game, images: [], addFace: face => faces.push(face),
    imageSource: value => value, trackTexture() {}, isCurrent: () => true, schedule() {} });
  const clips = faces.filter(face => face.element.className.endsWith('manual-clip')
    && face.normal[1] === -1 && face.element.style.clipPath);
  assert.equal(clips.length, 2, 'each retainer must have an actual XZ side profile');
  for (const clip of clips) {
    const translate = clip.transform(1).match(/translate3d\(([^p]+)px,([^p]+)px,([^p]+)px\)/).slice(1).map(Number);
    const points = [...clip.element.style.clipPath.matchAll(/([\d.]+)% ([\d.]+)%/g)].map(([,u,v]) => ({
      distance: profile.width/2-3.5-(translate[0]+(Number(u)/100-0.5)*clip.width),
      height: profile.depth/2-1.15-(translate[2]+(Number(v)/100-0.5)*clip.height),
    }));
    const heightsAt = distance => points.filter(p => Math.abs(p.distance-distance)<0.65).map(p => p.height);
    const root = heightsAt(4), middle = heightsAt(13), tip = heightsAt(22);
    assert.ok(root.length && middle.length && tip.length);
    assert.ok(Math.min(...root)>Math.max(...middle)+1, 'the middle must dip toward the manual');
    assert.ok(Math.max(...tip)>Math.max(...middle)+1.5, 'the free lip must rise in depth again');
    const opposite = faces.find(face => face.element.className.endsWith('manual-clip') && face.normal[1]===1
      && face.element.style.clipPath && Math.abs(Number(face.transform(1).match(/px,([^p]+)px,/)[1])-translate[1]-10.4)<1e-9);
    assert.ok(opposite, 'the profile must be swept 10.4 mm along Y, not drawn as a hook on the XY plane');
  }
});

test('DVD lids and spines animate about separate hinges, fit the viewport and stop drawing at rest', () => {
  const app = scene(); app.viewer.update(game, [...artwork, { kind: 'disc', path: 'disc.png' }]); app.flush(0);
  const front = app.face('front'), frontImage = front.children[1], closedWidth = parseFloat(front.style.width);
  assert.equal(discFace(app), undefined, 'opening must load the interior lazily');
  assert.equal(app.viewer.canOpen, true);
  app.viewer.toggleOpen(); app.flush(0); app.flush(325);
  assert.match(front.parentNode.style.transform, /rotateY\(-85deg\)/);
  assert.equal(app.frames.size, 1);
  app.flush(650);
  assert.match(front.parentNode.style.transform, /rotateY\(-170deg\)/);
  assert.match(app.face('left').parentNode.style.transform, /rotateY\(-85deg\)/);
  assert.equal(app.face('right').style.display, 'none', 'the closed side must not block the open cavity');
  assert.equal(app.face('back').style.display, '');
  assert.equal(app.frames.size, 0);
  assert.equal(parseFloat(front.style.width), closedWidth, 'opening must keep the high-resolution geometry fixed');
  assert.ok(Number(app.model().style.transform.match(/scale3d\(([^,]+)/)[1]) < 1, 'the opened assembly must scale down to fit around its new centre');
  const disc = discFace(app), image = disc.children.find(child => child.tag === 'img');
  assert.equal(image.src, 'asset:disc.png'); image.onload(); app.flush(700);
  assert.equal(disc.dataset.image, 'loaded'); assert.equal(disc.children[0].hidden, true);
  assert.ok(Math.abs(parseFloat(disc.style.width) / Number(app.model().style['--box-scale']) - 120) < 1e-9);
  app.viewer.zoom(0.5); app.flush(710);
  app.host.rect = { width: 1500, height: 900 }; app.observer.callback(); app.flush(720);
  assert.equal(discFace(app), disc); assert.equal(app.face('front').children[1], frontImage);
  assert.equal(disc.children.find(child => child.tag === 'img'), image, 'zoom and fullscreen reuse the original-resolution image');
  app.viewer.toggleOpen(); app.flush(730); app.flush(1380);
  assert.equal(app.model().dataset.open, 'false'); assert.equal(disc.style.display, 'none');
  assert.equal(app.face('right').style.display, ''); assert.equal(app.frames.size, 0);
  app.viewer.setOpen(true, false); app.flush(1400); assert.equal(discFace(app), disc);
});

test('PS2 has molded branding and a memory-card holder; DVD cases retain console-specific interiors', () => {
  for (const [platform, variant] of [['PS2', 'ps2'], ['Sony Playstation 2', 'ps2'], ['PC', 'dvd'], ['Wii', 'wii']]) {
    const app = scene(); app.viewer.update({ ...game, platform }, []); app.viewer.setOpen(true, false); app.flush();
    assert.equal(app.model().dataset.interior, variant);
    assert.equal(app.elements().some(face => face.className.includes('dvd-memory-slot')), variant === 'ps2');
    assert.equal(app.elements().some(face => face.className.includes('dvd-clip')), true);
    assert.equal(discFace(app).children[0].textContent, game.title);
    assert.equal(app.openingStates.at(-1).hasDisc, false);
  }
  for (const [platform, settings] of [['Nintendo 64'], ['Sega Master System'], ['PS2', { base: { model: 'dvd', spine_face: 'top' } }]]) {
    const app = scene(); app.viewer.update({ ...game, platform }, [], settings); app.flush();
    assert.equal(app.viewer.canOpen, false, platform); assert.equal(app.viewer.toggleOpen(), false);
    assert.equal(discFace(app), undefined);
  }
});

test('Missing and invalid disc art keep the fallback; stale loads and replaced images cannot leak into another game', () => {
  const app = scene(), images = [...artwork, { kind: 'disc', path: 'first.png' }, { kind: 'disc', path: 'second.png' }];
  app.viewer.update(game, images); app.viewer.setOpen(true, false); app.flush();
  const disc = discFace(app), image = disc.children.find(child => child.tag === 'img'), late = image.onload;
  assert.equal(image.src, 'asset:first.png', 'use the first disc, matching the media ordering');
  image.onerror(); assert.equal(image.src, ''); assert.equal(disc.dataset.image, 'missing');
  assert.notEqual(disc.children[0].hidden, true);
  app.viewer.update(game, [...artwork, { kind: 'disc', path: 'replacement.png' }]); app.flush();
  assert.equal(app.viewer.isOpen, true); assert.equal(image.onload, null);
  const replacement = discFace(app).children.find(child => child.tag === 'img');
  assert.equal(replacement.src, 'asset:replacement.png');
  late(); assert.equal(discFace(app).dataset.image, 'missing');
  app.viewer.update({ ...game, id: 2 }, images); app.flush();
  assert.equal(app.viewer.isOpen, false); assert.equal(discFace(app), undefined);
  assert.equal(replacement.src, ''); assert.equal(replacement.onload, null);
  app.viewer.toggleOpen(); app.flush(0); app.viewer.dispose();
  assert.equal(app.frames.size, 0); assert.equal(app.host.children.length, 0);
});

test('Keyboard opening respects reduced motion and resets close the box; changing its model disables opening', () => {
  const app = scene({ reducedMotion: true }); app.viewer.update(game, artwork); app.flush();
  app.host.trigger('keydown', { key: 'O' }); app.flush();
  assert.equal(app.viewer.isOpen, true); assert.equal(app.model().dataset.open, 'true');
  assert.equal(app.frames.size, 0);
  app.host.trigger('keydown', { key: 'o', ctrlKey: true }); assert.equal(app.viewer.isOpen, true);
  app.viewer.showBack(); app.flush(); assert.equal(app.viewer.isOpen, false);
  app.viewer.toggleOpen(); app.flush(); app.viewer.reset(); app.flush(); assert.equal(app.model().dataset.open, 'false');
  app.viewer.toggleOpen(); app.flush(); app.viewer.update(game, artwork, { base: { model: 'nes' } }); app.flush();
  assert.equal(app.viewer.canOpen, false); assert.equal(app.viewer.isOpen, false);
  assert.equal(discFace(app), undefined);
  app.viewer.clear(); assert.equal(app.openingStates.at(-1).canOpen, false);
});

test("Physical profiles distinguish console generations and their aliases", () => {
  const { profileFor } = scene().api;
  for (const [platform, id] of [["PS2", "dvd"], ["Sony Playstation 2", "dvd"], ["PlayStation", "jewel"], ["PS4", "bluray"],
    ["Nintendo DS", "ds"], ["Nintendo 3DS", "threeDs"], ["Nintendo Switch", "switch"], ["SNES", "snes"], ["NES", "nes"], ["Nintendo SNES", "snes"], ["Nintendo NES", "nes"],
    ["Nintendo 64", "n64"], ["Game Boy Advance", "gameBoy"], ["Sega Mega Drive", "genesis"], ["PSP", "psp"], ["PlayStation Vita", "vita"]]) {
    assert.equal(profileFor(platform).id, id, platform);
  }
  assert.equal(profileFor("PS2").height / profileFor("PS2").width, 190 / 135);
  assert.equal(profileFor("Switch").depth, 11);
  assert.equal(profileFor("SNES").spineFace, "top");
  assert.equal(profileFor("SNES", 0.6).id, "sfc");
  assert.equal(profileFor("GameCube", 0.7, "game (Japan).rvz").id, "gameCubeJapan");
  assert.equal(profileFor("PS1", null, "game (Europe).chd").id, "jewelPal");
  assert.equal(profileFor("Arcade", 1.2).id, "generic");
  assert.ok(profileFor("Custom console", 1.2).width > profileFor("Custom console", 0.6).width);
});

test("Console styles preserve automatic regions and allow presets, custom geometry, colors and regional overrides", () => {
  const { profileFor, regionFor } = scene().api;
  assert.equal(regionFor('C:/Games (Japan)/game (USA, Europe).iso'), 'north_america');
  assert.equal(regionFor('game (En,Es) (Europe).iso'), 'europe');
  assert.equal(regionFor('C:/Games (Europe)/game.iso'), null);
  assert.notEqual(profileFor('PS2', null, 'game (Europe).iso').color, profileFor('PS2', null, 'game (USA).iso').color);
  const settings = {base:{model:'switch',color:'#123456'},regions:{europe:{model:null,color:'#abcdef'},japan:{model:'custom',width:110,height:200,depth:25,spine_face:'top'}}};
  assert.equal(profileFor('New console', 0.8, '', settings).id, 'switch');
  assert.equal(profileFor('New console', 0.8, '', settings).color, '#123456');
  assert.equal(profileFor('PS2', 0.8, 'game (Europe).iso', settings).id, 'dvd');
  assert.equal(profileFor('PS2', 0.8, 'game (Europe).iso', settings).color, '#abcdef');
  const japan = profileFor('New console', 0.8, 'game (Japan).iso', settings);
  assert.deepEqual([japan.id,japan.width,japan.height,japan.depth,japan.spineFace],['custom',110,200,25,'top']);
  assert.equal(profileFor('PS2', null, '', {base:{model:'custom',width:-1,height:200,depth:25,color:'invalid',spine_face:'bad'}}).id, 'dvd');
});

test("Saved overrides survive cover loading, remap the spine, and update without losing rotation", () => {
  const app = scene(), settings = {base:{model:'custom',width:150,height:200,depth:25,spine_face:'top',color:'#123456'}};
  app.viewer.update(game, artwork, settings); app.flush(); app.loadCover();
  assert.equal(app.face('top').children[1].src,'asset:spine.png');
  assert.equal(app.model().style['--box-material'],'#123456');
  const size=[app.face('front').style.width,app.face('front').style.height];
  const image=app.face('front').children[1]; image.naturalWidth=999;image.naturalHeight=100;image.onload();
  assert.deepEqual([app.face('front').style.width,app.face('front').style.height],size);
  assert.equal(parseFloat(size[0])/parseFloat(size[1]),150/200);
  assert.equal(app.profiles.at(-1).width,150);
  assert.equal(app.host.dataset.format,'custom');
  app.viewer.showBack();app.flush();const before=app.model().style.transform.split(' scale3d')[0];
  app.viewer.update(game,artwork,{base:{model:'jewel'}});app.flush();app.loadCover();
  assert.equal(app.host.dataset.format,'jewel');
  assert.equal(app.model().style.transform.split(' scale3d')[0],before);
  assert.equal(app.face('left').children[1].src,'asset:spine.png');
  app.viewer.update(game,artwork,null);app.flush();assert.equal(app.host.dataset.format,'dvd');
});

test("PS1 and Dreamcast jewel cases expose the hinge, repeat tray spines and use a separate thin acrylic lid", () => {
  for (const [platform, rom_path, color] of [
    ['PS1', 'Game (USA).chd', '#181a1e'], ['PS1', 'Game (Europe).chd', '#181a1e'],
    ['Dreamcast', 'Game (USA).chd', '#b8c2c9'], ['Dreamcast', 'Game (Europe).chd', '#204b85'],
  ]) {
    const app = scene(); app.viewer.update({ ...game, platform, rom_path }, artwork); app.flush(); app.loadCover();
    const model = app.model(), front = app.face('front'), image = front.children[1];
    assert.equal(model.dataset.construction, 'jewel');
    assert.equal(model.style['--box-jewel-tray'], color);
    const inset = app.elements().find(child => child.className === 'game-box-face game-box-jewel-inset');
    assert.ok(inset);
    assert.ok(parseFloat(image.style.left) > 0 && parseFloat(image.style.width) < 100);
    assert.equal(image.style.objectFit, 'contain', 'the printed booklet should fit inside the lid without stretching');
    const lid = app.elements().find(child => child.className === 'game-box-face game-box-acrylic-lid');
    assert.ok(lid);
    assert.equal(lid.children.length, 0, 'the acrylic layer must not duplicate or downsample the cover image');
    assert.ok(parseFloat(lid.style.width)<parseFloat(front.style.width),'the opening cover excludes the fixed hinge acrylic');
    const z = Number(lid.style.transform.match(/translate3d\([^,]+,[^,]+,([^p]+)px\)/)[1]);
    const frontZ = Number(front.style.transform.match(/translateZ\(([^p]+)px\)/)[1]);
    assert.ok(z > frontZ, 'the acrylic must sit in front of the booklet');
    assert.equal(app.face('left').children[1].src, 'asset:spine.png');
    assert.equal(app.face('right').children[1].src, 'asset:spine.png');
    const seam = app.face('right').children.find(child => child.className === 'game-box-case-seam');
    assert.ok(parseFloat(seam.style['--box-seam-position']) > 0 && parseFloat(seam.style['--box-seam-position']) < 25, 'only the thin front lid opens, not half of the case');
    assert.equal(model.children.find(child => child.className === 'game-box-folds').children.length, 0, 'jewel booklets do not wrap from the front onto the tray spine');
    const currentImage = image, currentLid = lid;
    app.viewer.zoom(0.5); app.flush();
    assert.equal(app.face('front').children[1], currentImage);
    assert.equal(app.elements().find(child => child.className === 'game-box-face game-box-acrylic-lid'), currentLid);
  }
});

test("Jewel styling respects overrides, while DS keeps a full-cover sleeve and a single spine after switching models", () => {
  const app = scene();
  app.viewer.update({ ...game, platform: 'Dreamcast' }, artwork, { base: { model: 'jewel', color: '#123456', spine_face: 'top' } }); app.flush(); app.loadCover();
  assert.equal(app.model().style['--box-jewel-tray'], '#123456');
  assert.equal(app.face('top').children[1].src, 'asset:spine.png');
  assert.equal(app.face('bottom').children[1].src, 'asset:spine.png');
  const oldImage = app.face('top').children[1];
  for (const platform of ['Nintendo DS', 'Nintendo 3DS']) {
    app.viewer.update({ ...game, platform }, artwork); app.flush(); app.loadCover();
    assert.equal(app.model().dataset.construction, 'sleeve');
    assert.equal(app.face('left').children[1].src, 'asset:spine.png');
    assert.equal(app.face('right').children.some(child => child.tag === 'img'), false);
    assert.equal(app.face('front').children.some(child => child.className === 'game-box-jewel-hinge'), false);
    assert.equal(app.elements().some(child => child.className === 'game-box-face game-box-acrylic-lid'), false);
    assert.equal(app.face('front').children[1].style.left, '0%', 'DS has a continuous sleeve rather than a jewel-case hinge');
    assert.equal(app.face('right').children.find(child => child.className === 'game-box-case-seam').style['--box-seam-position'], '50%');
    assert.equal(app.elements().filter(child => child.className === 'game-box-face game-box-fold').length,32);
  }
  assert.equal(oldImage.src, ''); assert.equal(oldImage.onload, null);
});

test("Rotations preserve geometry, expose back and opposite sides, and never translate the box", () => {
  const { math } = scene().api;
  const back = math.rotate(math.axisAngle([0, 1, 0], 180), [0, 0, 1]);
  assert.ok(Math.abs(back[0]) < 1e-10); assert.ok(Math.abs(back[2] + 1) < 1e-10);
  const opposite = math.between([1, 0, 0], [-1, 0, 0]);
  assert.ok(Math.abs(math.rotate(opposite, [1, 0, 0])[0] + 1) < 1e-10);
  let q = [0, 0, 0, 1];
  for (let i = 0; i < 10000; i++) q = math.multiply(math.axisAngle(i % 2 ? [1, 0, 0] : [0, 1, 0], 3), q);
  assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-10);
  const m = math.matrix(q);
  assert.deepEqual(Array.from(m.slice(12)), [0, 0, 0, 1]);
  assert.ok(Math.abs(Math.hypot(...math.rotate(q, [1, 0, 0])) - 1) < 1e-10);
});

test("The box maps front, back and spine onto distinct outward-facing faces", () => {
  const app = scene(); app.viewer.update(game, artwork); app.flush(); app.loadCover();
  assert.equal(app.elements().filter(face => face.dataset.face).length, 6);
  assert.equal(app.face("front").children[1].src, "asset:front.png");
  assert.equal(app.face("back").children[1].src, "asset:back.png");
  assert.equal(app.face("left").children[1].src, "asset:spine.png");
  assert.match(app.face("back").style.transform, /rotateY\(180deg\)/);
  assert.ok(Math.abs(parseFloat(app.face("left").style.width)/parseFloat(app.face("front").style.width)-14/135)<1e-10);
  assert.equal(app.face("top").style.height, app.face("left").style.width);
  assert.equal(app.frames.size, 0);
  const image = app.face("front").children[1];
  image.naturalWidth = 135; image.naturalHeight = 190; image.onload();
  assert.equal(image.classList.contains("loaded"), true);
  assert.equal(app.face("front").children[0].hidden, true);
});

test("DVD opening channels follow the spine orientation; Genesis, CD and cardboard do not get a recess", () => {
  const app = scene();
  for (const [platform, settings, expected, axis, recess] of [
    ['PS2', null, 'right', 'vertical', true],
    ['PS4', null, 'right', 'vertical', true],
    ['PS3', null, 'right', 'vertical', true],
    ['Xbox', null, 'right', 'vertical', true],
    ['Xbox 360', null, 'right', 'vertical', true],
    ['Wii', null, 'right', 'vertical', true],
    ['Wii U', null, 'right', 'vertical', true],
    ['GameCube', null, 'right', 'vertical', true],
    ['PSP', null, 'right', 'vertical', true],
    ['Nintendo Switch', null, 'right', 'vertical', true],
    ['Nintendo DS', null, 'right', 'vertical', true],
    ['Nintendo 3DS', null, 'right', 'vertical', true],
    ['PS1', null, 'right', 'vertical', false],
    ['Sega Genesis', null, 'right', 'vertical', false],
    ['Sega Mega Drive', null, 'right', 'vertical', false],
    ['Unknown console', null, 'right', 'vertical', false],
    ['PS2', { base: { model: 'dvd', spine_face: 'top' } }, 'bottom', 'horizontal', true],
    ['Nintendo 64', null, null, null, false],
  ]) {
    app.viewer.update({ ...game, platform }, artwork, settings); app.flush();
    const openings = app.elements().filter(face => face.dataset.opening);
    assert.equal(openings.length, expected ? 1 : 0);
    if (!expected) continue;
    const face = openings[0]; assert.equal(face.dataset.face, expected); assert.equal(face.dataset.opening, axis);
    const grip = face.children.find(child => child.className === 'game-box-opening-detail');
    assert.ok(grip);
    assert.equal(grip.dataset.recess === 'keep-case', recess);
    if (recess) {
      const profile = app.profiles.at(-1), span = axis === 'vertical' ? profile.height : profile.width;
      const length = parseFloat(grip.style['--box-grip-long']);
      assert.ok(Math.abs(length / span - (['psp','switch','ds','dsPal','threeDs'].includes(profile.id) ? .60 : .45))<1e-9);
      assert.ok(parseFloat(grip.style['--box-grip-short']) < profile.depth);
      assert.ok(parseFloat(grip.style['--box-grip-radius']) < parseFloat(grip.style['--box-grip-short']) / 2, 'the recess must have straight sides, not an oval silhouette');
    }
    app.viewer.zoom(0.2); app.flush();
    assert.equal(face.children.find(child => child.className === 'game-box-opening-detail'), grip);
  }
});

test("The closing seam follows all three free edges and curved corners, including Genesis without a recess", () => {
  const app = scene();
  for (const [platform, settings, expected] of [
    ['PS2', null, ['bottom', 'right', 'top']],
    ['Sega Genesis', null, ['bottom', 'right', 'top']],
    ['PS2', { base: { model: 'dvd', spine_face: 'top' } }, ['bottom', 'left', 'right']],
    ['Nintendo 64', null, []],
  ]) {
    app.viewer.update({ ...game, platform }, artwork, settings); app.flush();
    const faces = app.elements().filter(face => face.dataset.face);
    assert.deepEqual(faces.filter(face => face.dataset.seam).map(face => face.dataset.face).sort(), expected);
    for (const face of faces) {
      const seam = face.children.find(child => child.className === 'game-box-case-seam');
      assert.equal(!!seam, expected.includes(face.dataset.face));
      if (seam) assert.equal(face.dataset.seam, ['left', 'right'].includes(face.dataset.face) ? 'vertical' : 'horizontal');
    }
    const corners = app.elements().find(element => element.className === 'game-box-corners');
    assert.equal(corners.children.filter(face => face.children.some(child => child.className === 'game-box-case-seam')).length, expected.length&&platform!=='Sega Genesis' ? 96 : 0);
    if (platform === 'Sega Genesis') assert.equal(app.face('right').children.find(child => child.className === 'game-box-opening-detail').dataset.recess, undefined);
  }
});

test("Curved case walls close every corner without gaps and keep a softer opening than hinge", () => {
  for (const platform of ['PS2', 'PS1', 'Nintendo 64']) {
    const app = scene(); app.viewer.update({ ...game, platform }, artwork); app.flush();
    const group = app.elements().find(element => element.className === 'game-box-corners');
    assert.equal(group.children.length, platform === 'Nintendo 64' ? 0 : 96);
    const radii = ['tl', 'tr', 'br', 'bl'].map(corner => parseFloat(app.model().style[`--box-corner-${corner}`]));
    if (platform !== 'Nintendo 64') assert.ok(radii[1] > radii[0], 'opening corners must be rounder than the hinge');
    const width = parseFloat(app.face('front').style.width), height = parseFloat(app.face('front').style.height);
    const [tl, tr, br, bl] = radii;
    const ends = [
      [[-width/2, -height/2+tl], [-width/2+tl, -height/2]],
      [[width/2-tr, -height/2], [width/2, -height/2+tr]],
      [[width/2, height/2-br], [width/2-br, height/2]],
      [[-width/2+bl, height/2], [-width/2, height/2-bl]],
    ];
    const near = (actual, expected) => assert.ok(Math.hypot(actual[0]-expected[0], actual[1]-expected[1]) < 1e-8, 'curve must meet the adjacent wall');
    group.children.forEach((strip, index) => {
      const transform = strip.style.transform.match(/translate3d\(([^p]+)px, ([^p]+)px, 0\) rotateZ\(([^d]+)deg\)/);
      assert.ok(transform);
      const x = Number(transform[1]), y = Number(transform[2]), angle = Number(transform[3]) * Math.PI / 180;
      const half = parseFloat(strip.style.width) / 2;
      const start = [x - Math.cos(angle)*half, y - Math.sin(angle)*half];
      const end = [x + Math.cos(angle)*half, y + Math.sin(angle)*half];
      const corner = Math.floor(index / 24), part = index % 24;
      if (!part) near(start, ends[corner][0]);
      else near(start, ends[corner].previous);
      if (part === 23) near(end, ends[corner][1]);
      ends[corner].previous = end;
      assert.equal(strip.style.height, app.face('top').style.height, 'curved walls must span the full case depth');
    });
    assert.equal(app.frames.size, 0, 'rounded geometry must stay idle between interactions');
  }
});

test("Rounded edges scale with zoom, preserve textures and support top spines and small custom cases", () => {
  const app = scene();
  const settings = { base: { model: 'custom', width: 20, height: 20, depth: 1, spine_face: 'top' } };
  app.viewer.update(game, artwork, settings); app.flush();
  const radius = name => parseFloat(app.model().style[`--box-corner-${name}`]);
  assert.equal(radius('tl'), radius('tr'));
  assert.ok(radius('bl') > radius('tl'));
  assert.equal(radius('br'), radius('bl'));
  assert.ok(radius('tr') + radius('br') < parseFloat(app.face('front').style.height));
  const before = radius('br'), image = app.face('top').children[1];
  const corners = app.elements().find(element => element.className === 'game-box-corners');
  app.viewer.zoom(0.5); app.flush();
  assert.ok(Math.abs(radius('br') / before - 1.5) < 1e-10);
  assert.equal(app.face('top').children[1], image);
  assert.equal(app.elements().find(element => element.className === 'game-box-corners'), corners);
});

test("Spine folds use the original artwork with gradual normals and release their textures on clear", () => {
  for (const top of [false, true]) {
    const app = scene(), settings = { base: { model: 'dvd', spine_face: top ? 'top' : 'left' } };
    app.viewer.update(game, artwork, settings); app.flush();
    const group = app.elements().find(element => element.className === 'game-box-folds');
    const strips = app.elements().filter(element => element.className === 'game-box-face game-box-fold');
    assert.equal(strips.length, 32); assert.equal(app.elements().filter(e=>e.className==='game-box-face game-box-fold-cap').length,4,'both folds need closed end caps');
    const radius = parseFloat(app.model().style['--box-fold-radius']);
    assert.ok(radius > 0 && radius < 1, 'the fold must be subtle rather than a large hinge');
    for (const join of ['front', 'back']) {
      const parts = strips.filter(strip => strip.dataset.join === join);
      assert.deepEqual(parts.map(strip => strip.dataset.source), Array(8).fill(join === 'front' ? 'cover' : 'back_cover').concat(Array(8).fill('spine')));
      const angles = parts.map(strip => Number(strip.style.transform.match(top ? /rotateX\(([^d]+)deg/ : /rotateY\(([^d]+)deg/)[1]));
      for (let i = 1; i < angles.length; i++) assert.ok(Math.abs(Math.abs(angles[i] - angles[i-1]) - 5.625) < 1e-9, 'normals must turn continuously, not retain a right-angle join');
      for (const strip of parts) {
        const art = strip.children[0], ink = art.children[0];
        assert.equal(ink.style.backgroundImage, `var(--box-texture-${strip.dataset.source}, none)`);
        assert.ok(parseFloat(art.style.width) > 0 && parseFloat(art.style.height) > 0);
      }
    }
    assert.equal(app.model().style['--box-texture-cover'], 'none');
    for (const [name, kind, width, height] of [['front', 'cover', 1080, 1520], ['back', 'back_cover', 1080, 1520], [top ? 'top' : 'left', 'spine', 100, 1520]]) {
      const image = app.face(name).children[1]; image.naturalWidth = width; image.naturalHeight = height; image.onload();
      assert.equal(app.model().style[`--box-texture-${kind}`], `url("asset:${kind === 'cover' ? 'front' : kind === 'back_cover' ? 'back' : 'spine'}.png")`);
    }
    assert.equal(app.model().dataset.spineRotated, top ? 'true' : 'false');
    const before = strips[0].children[0].style.width, image = app.face('front').children[1];
    app.viewer.zoom(0.5); app.flush();
    assert.ok(Math.abs(parseFloat(strips[0].children[0].style.width) / parseFloat(before) - 1.5) < 1e-10);
    assert.equal(app.face('front').children[1], image, 'zoom must keep the original image');
    assert.equal(app.elements().find(element => element.className === 'game-box-folds'), group);
    assert.equal(app.frames.size, 0);
    app.viewer.clear();
    for (const kind of ['cover', 'back_cover', 'spine']) assert.equal(app.model().style[`--box-texture-${kind}`], 'none');
  }
});

test("CD faces grow to fullscreen and zoom resolution without magnifying cached layers or reloading textures", () => {
  for (const rom_path of ['Game (USA).chd','Game (Europe).chd']) {
    const app=scene();app.viewer.update({...game,platform:'PS1',rom_path},artwork);app.flush();
    const front=app.face('front'),back=app.face('back'),spine=app.face('left').children[1];
    const original=front.children[1], smallWidth=parseFloat(front.style.width), rotation=app.model().style.transform;
    const profile=app.profiles.at(-1);
    spine.naturalWidth=1800;spine.naturalHeight=90;spine.onload();
    assert.match(spine.style.width,/%$/);
    app.host.rect={left:0,top:0,width:1920,height:900};app.observer.callback();app.flush();
    const fullWidth=parseFloat(front.style.width);
    assert.ok(fullWidth>smallWidth*2,'fullscreen must increase the rasterized face dimensions');
    assert.equal(parseFloat(back.style.width),fullWidth);
    assert.equal(app.model().style.transform,rotation,'the parent must only rotate; it must not upscale a small raster');
    assert.doesNotMatch(rotation,/scale/);
    const depth=parseFloat(app.face('left').style.width);
    assert.ok(Math.abs(depth/fullWidth-profile.depth/profile.width)<1e-10);
    const fullTranslation=Number(front.style.transform.match(/translateZ\(([^p]+)px\)/)[1]);
    assert.ok(Math.abs(fullTranslation-depth/2)<1e-10,'all six faces must keep the same physical geometry');
    app.viewer.zoom(0.6);app.flush();
    assert.ok(Math.abs(parseFloat(front.style.width)/fullWidth-1.6)<1e-10);
    assert.equal(front.children[1],original);assert.equal(app.face('left').children[1],spine);
    assert.ok(Math.abs(parseFloat(spine.style.width)/100-profile.height/profile.depth)<1e-10);
    app.host.rect={left:0,top:0,width:360,height:320};app.observer.callback();app.flush();
    assert.ok(Math.abs(parseFloat(front.style.width)/smallWidth-1.6)<1e-10);
    assert.equal(app.frames.size,0,'resizing and zoom must not start an animation loop');
  }
});

test("Dragging uses pointer capture, batches redraws and keeps the center fixed", () => {
  const app = scene(); app.viewer.update(game, artwork); app.flush();
  const initial = app.model().style.transform;
  app.host.trigger("pointerdown");
  app.host.trigger("pointermove", { clientX: 220, clientY: 180 });
  app.host.trigger("pointermove", { clientX: 240, clientY: 190 });
  assert.equal(app.frames.size, 1);
  assert.equal(app.host.hasPointerCapture(1), true);
  app.flush(); assert.notEqual(app.model().style.transform, initial);
  assert.equal(app.frames.size, 0);
  const rotated = app.model().style.transform;
  app.host.trigger("dblclick"); app.flush();
  assert.equal(app.model().style.transform, rotated);
  app.host.trigger("pointercancel"); assert.equal(app.host.hasPointerCapture(1), false);
  const matrix = app.model().style.transform.match(/matrix3d\(([^)]+)\)/)[1].split(",").map(Number);
  assert.deepEqual(matrix.slice(12), [0, 0, 0, 1]);
  app.viewer.reset(); app.flush(); assert.equal(app.model().style.transform, initial);
});

test("Refreshing the same game preserves rotation and textures; switching releases old images", () => {
  const app = scene(); app.viewer.update(game, artwork); app.flush();
  app.viewer.showBack(); app.flush();
  const before = app.model().style.transform, image = app.face("front").children[1], late = image.onload;
  app.viewer.update({ ...game }, artwork); app.flush();
  assert.equal(app.model().style.transform, before);
  assert.equal(app.face("front").children[1], image);
  app.viewer.update({ ...game, id: 2, title: "Second", platform: "Switch" }, []); app.flush();
  assert.equal(image.src, ""); assert.equal(image.onload, null);
  late(); assert.equal(app.host.dataset.format, "switch");
  assert.equal(app.face("front").children.length, 1);
  assert.equal(app.face("front").children[0].textContent, "Second");
});

test("Regional artwork adjusts box proportions and horizontal spines are rotated to fit", () => {
  const app = scene(); app.viewer.update({ ...game, platform: "SNES" }, artwork); app.loadCover();
  assert.equal(app.face("top").children[1].src, "asset:spine.png");
  let image = app.face("front").children[1];
  image.naturalWidth = 105; image.naturalHeight = 190; image.onload();
  assert.equal(app.host.dataset.format, "sfc");
  image = app.face("left").children[1]; image.naturalWidth = 900; image.naturalHeight = 60; image.onload();
  assert.match(image.style.transform, /rotate\(90deg\)/);
});

test("Broken images retain fallbacks, keyboard rotation works and disposal stops all work", () => {
  const app = scene(); app.viewer.update(game, artwork); app.flush();
  const image = app.face("back").children[1]; image.onerror();
  assert.equal(image.src, ""); assert.notEqual(app.face("back").children[0].hidden, true);
  const before = app.model().style.transform;
  app.host.trigger("keydown", { key: "ArrowRight" }); app.flush(); assert.notEqual(app.model().style.transform, before);
  app.host.trigger("keydown", { key: "Home" }); app.flush(); assert.equal(app.model().style.transform, before);
  app.viewer.zoom(0.15); assert.equal(app.frames.size, 1);
  app.viewer.dispose(); assert.equal(app.frames.size, 0); assert.equal(app.observer.disconnected, true);
  assert.equal(app.host.children.length, 0); assert.equal(Object.keys(app.host.handlers).length, 0);
});


test('Clicking the booklet extracts it, while dragging or cancelling a pointer only manipulates the box', async () => {
  const data = booklet(); const activations = []; let closes = 0;
  const app = scene({ loadManual: async () => data, onManualActivate: value => { activations.push(value); return true; }, onManualDeactivate: () => closes++ });
  app.viewer.update(game, artwork); await turn(); app.viewer.setOpen(true, false); app.flush();
  const front = app.elements().find(face => face.className.endsWith('manual-front'));
  assert.equal(front.dataset.manualBooklet, 'true'); assert.equal(app.model().dataset.manualInteractive, 'true');
  const target = { closest: () => front };
  app.host.trigger('pointerdown', { target }); app.host.trigger('pointermove', { clientX: 182, clientY: 161 });
  app.host.trigger('pointerup', { type: 'pointerup' }); app.flush();
  assert.equal(activations.length, 1); assert.equal(activations[0].manual, data); assert.equal(activations[0].origin, front);
  assert.equal(app.model().dataset.manualExtracted, 'true'); assert.equal(app.model().dataset.manualInteractive, 'false');
  assert.equal(app.viewer.readManual(), false); app.viewer.returnManual(); app.flush();
  app.host.trigger('pointerdown', { target }); app.host.trigger('pointermove', { clientX: 230 }); app.host.trigger('pointerup', { type: 'pointerup' });
  assert.equal(activations.length, 1);
  app.host.trigger('pointerdown', { target }); app.host.trigger('pointercancel', { type: 'pointercancel' });
  assert.equal(activations.length, 1);
  app.host.trigger('keydown', { key: 'm' }); assert.equal(activations.length, 2);
  const before = closes; app.viewer.setOpen(false, false); assert.equal(closes, before + 1); assert.equal(app.viewer.readManual(), false);
  app.viewer.setOpen(true, false); app.flush(); app.viewer.readManual(); app.viewer.refreshManual();
  assert.ok(closes > before + 1); assert.equal(app.model().dataset.manualExtracted, undefined);
});


test('One side control alternates front/back and first restores the front after manual rotation', () => {
  const app = scene(); app.viewer.update(game, artwork); app.flush(); const front = app.model().style.transform;
  app.viewer.zoom(.3); app.flush(); const scale = app.model().style['--box-scale'];
  app.viewer.toggleSide(); app.flush(); const back = app.model().style.transform; assert.notEqual(back, front);
  assert.equal(app.model().style['--box-scale'], scale, 'switching sides preserves zoom');
  app.viewer.toggleSide(); app.flush(); assert.equal(app.model().style.transform, front);
  app.host.trigger('pointerdown'); app.host.trigger('pointermove', { clientX: 240, clientY: 190 }); app.host.trigger('pointerup'); app.flush();
  assert.notEqual(app.model().style.transform, front);
  app.viewer.toggleSide(); app.flush(); assert.equal(app.model().style.transform, front);
  app.viewer.toggleSide(); app.flush(); assert.equal(app.model().style.transform, back);
  app.host.trigger('keydown', { key: 'ArrowLeft' }); app.flush();
  app.viewer.toggleSide(); app.flush(); assert.equal(app.model().style.transform, front);
  app.viewer.setOpen(true, false); app.flush(); app.viewer.toggleSide(); app.flush();
  assert.equal(app.viewer.isOpen, false); assert.equal(app.model().style.transform, front);
  app.viewer.toggleSide(); app.viewer.update({ ...game, id: 2 }, artwork); app.flush();
  app.viewer.toggleSide(); app.flush(); assert.equal(app.model().style.transform, back, 'new games start with the front as the current side');
  app.viewer.dispose();
});

test('Wheel zoom stays in the 3D viewer, supports different delta units and stops with disposal', () => {
  const app = scene(); app.viewer.update(game, artwork); app.flush();
  const width = () => parseFloat(app.face('front').style.width), original = width(); let prevented = 0, stopped = 0;
  app.host.trigger('wheel', { deltaY: -120, preventDefault() { prevented++; }, stopPropagation() { stopped++; } }); app.flush();
  assert.ok(width() > original); assert.equal(prevented, 1); assert.equal(stopped, 1); assert.equal(app.frames.size, 0);
  app.host.trigger('wheel', { deltaY: 120 }); app.flush(); assert.ok(Math.abs(width() - original) < .001);
  app.host.trigger('wheel', { deltaY: -1, deltaMode: 1 }); app.flush(); const line = width();
  app.viewer.reset(); app.flush(); app.host.trigger('wheel', { deltaY: -16 }); app.flush(); assert.equal(width(), line);
  app.viewer.reset(); app.flush(); app.host.trigger('wheel', { deltaY: -1, deltaMode: 2 }); app.flush(); assert.ok(width() > line);
  for (let i = 0; i < 30; i++) app.host.trigger('wheel', { deltaY: -120 }); app.flush();
  const max = width(); app.host.trigger('wheel', { deltaY: -120 }); app.flush(); assert.equal(width(), max);
  for (let i = 0; i < 30; i++) app.host.trigger('wheel', { deltaY: 120 }); app.flush();
  const min = width(); app.host.trigger('wheel', { deltaY: 120 }); app.flush(); assert.equal(width(), min);
  assert.ok(max > original && min < original);
  app.viewer.dispose(); app.host.trigger('wheel', { deltaY: -120 }); assert.equal(app.frames.size, 0);
});


test('Printed sleeves retain square corners within the rounded plastic, aligned continuously with both spine folds', () => {
  for (const platform of ['PS2', 'Nintendo Switch', 'Nintendo Wii', 'Xbox 360', 'PS5', 'Nintendo DS']) {
    const app = scene(); app.viewer.update({ ...game, platform }, artwork); app.flush();
    const front = app.face('front'), back = app.face('back'), spine = app.face('left');
    const img = front.children[1], rear = back.children[1], side = spine.children[1];
    const h = parseFloat(front.style.height), w = parseFloat(front.style.width), radius = parseFloat(app.model().style['--box-corner-tr']);
    assert.equal(img.style.borderRadius, '0'); assert.equal(rear.style.borderRadius, '0');
    assert.ok(parseFloat(img.style.top) * h / 100 > radius, `${platform}: paper corners must clear the outer plastic curve`);
    assert.equal(img.style.left, '0%'); assert.ok(parseFloat(img.style.width) < 100);
    assert.ok(parseFloat(rear.style.left) > 0); assert.ok(parseFloat(rear.style.width) < 100);
    assert.equal(side.style.top, img.style.top); assert.equal(side.style.height, img.style.height);
    const folds = app.elements().filter(e => e.dataset.join);
    assert.ok(folds.every(e => Math.abs(parseFloat(e.style.height) - h * parseFloat(img.style.height) / 100) < 1e-8));
    const sourceWidth = parseFloat(folds.find(e => e.dataset.source === 'cover').children[0].style.width);
    assert.ok(Math.abs(sourceWidth - w * parseFloat(img.style.width) / 100) < 1e-8, 'fold sampling uses the inset cover dimensions');
    app.viewer.dispose();
  }
});

test('Curve lighting is continuous across adjacent facets and retains a bounded, idle mesh', () => {
  const app = scene(); app.viewer.update(game, artwork); app.flush();
  const strips = app.elements().find(e => e.className === 'game-box-corners').children;
  for (let i = 1; i < strips.length; i++) {
    if (!strips[i-1].style['--box-shade-end'] || !strips[i].style['--box-shade-start']) continue;
    assert.ok(Math.abs(+strips[i-1].style['--box-shade-end'] - +strips[i].style['--box-shade-start']) < 1e-10);
    assert.ok(Math.abs(+strips[i-1].style['--box-gloss-end'] - +strips[i].style['--box-gloss-start']) < 1e-10);
  }
  assert.equal(app.frames.size, 0); app.viewer.dispose();
});

test('Rotation locks constrain mouse and keyboard to the unlocked axis; free mode restores arcball movement', () => {
  const app = scene(); app.viewer.update(game, artwork); app.flush();
  const initial = app.model().style.transform;
  const drag = (x, y) => { app.host.trigger('pointerdown'); app.host.trigger('pointermove', { clientX: x, clientY: y }); app.host.trigger('pointerup'); app.flush(); };
  app.viewer.setRotationLock('x'); drag(180, 240); assert.equal(app.model().style.transform, initial);
  drag(260, 160); const horizontal = app.model().style.transform; assert.notEqual(horizontal, initial);
  app.host.trigger('keydown', { key: 'ArrowDown' }); app.flush(); assert.equal(app.model().style.transform, horizontal);
  app.viewer.reset(); app.flush(); app.viewer.setRotationLock('y'); drag(260, 160); assert.equal(app.model().style.transform, initial);
  drag(180, 240); const vertical = app.model().style.transform; assert.notEqual(vertical, initial);
  app.host.trigger('keydown', { key: 'ArrowRight' }); app.flush(); assert.equal(app.model().style.transform, vertical);
  app.viewer.setRotationLock('invalid'); assert.equal(app.viewer.rotationLock, 'y');
  app.viewer.update({ ...game, id: 2 }, artwork); app.flush(); assert.equal(app.viewer.rotationLock, 'y');
  app.viewer.setRotationLock('free'); drag(260, 240); assert.notEqual(app.model().style.transform, initial);
  assert.equal(app.host.dataset.rotationLock, 'free'); app.viewer.dispose();
});

test('The 3D context menu selects one rotation mode and is removed on resize, game changes and disposal', () => {
  const app = scene(); app.viewer.update(game, artwork); app.flush();
  app.host.trigger('contextmenu'); const menu = app.host.children[1];
  assert.equal(menu.attributes.role, 'menu'); assert.equal(menu.children.length, 3);
  assert.equal(menu.children[0].attributes['aria-checked'], 'true');
  assert.ok(parseFloat(menu.style.left) >= 8 && parseFloat(menu.style.left) + 210 <= 360 - 8);
  menu.children[1].trigger('click'); assert.equal(app.viewer.rotationLock, 'x'); assert.equal(app.host.children.length, 1);
  app.host.trigger('contextmenu'); assert.equal(app.host.children[1].children[1].attributes['aria-checked'], 'true');
  app.host.children[1].trigger('keydown', { key: 'Escape' }); assert.equal(app.host.children.length, 1);
  app.host.trigger('contextmenu'); app.observer.callback(); assert.equal(app.host.children.length, 1);
  app.host.trigger('contextmenu'); app.viewer.update({ ...game, id: 2 }, artwork); assert.equal(app.host.children.length, 1);
  app.host.trigger('contextmenu'); app.viewer.dispose(); assert.equal(app.host.children.length, 0);
});

test('The 3D context menu offers the four cover modes only with a prepared manual, including keyboard access',async()=>{
  const data=booklet(), selected=[];
  const app=scene({loadManual:async()=>data,onManualCoverChange:mode=>{selected.push(mode);data.coverMode=mode;}});
  app.viewer.update(game,artwork);app.flush();app.host.trigger('contextmenu');
  assert.equal(app.host.children[1].children.length,3,'pending manuals have no cover controls');
  app.host.children[1].trigger('keydown',{key:'Escape'});await turn();app.flush();
  app.host.trigger('contextmenu');const menu=app.host.children[1], group=menu.children[3];
  assert.equal(group.attributes.role,'group');assert.equal(group.attributes['aria-label'],'Portada del manual');
  const buttons=group.children.slice(1);
  assert.deepEqual(buttons.map(item=>item.textContent),['Automático','Página completa','Mitad derecha','Mitad izquierda']);
  assert.equal(buttons[0].attributes['aria-checked'],'true');
  menu.trigger('keydown',{key:'End',target:menu.children[0]});assert.equal(buttons[3].focused,true);
  let prevented=false;app.host.trigger('wheel',{target:buttons[3],deltaY:120,preventDefault(){prevented=true;}});
  assert.equal(prevented,false,'a tall context menu can scroll instead of zooming the box');
  buttons[3].trigger('click');assert.deepEqual(selected,['left']);assert.equal(app.host.children.length,1);
  assert.equal(app.viewer.rotationLock,'free');app.host.trigger('contextmenu');
  assert.equal(app.host.children[1].children[3].children[4].attributes['aria-checked'],'true');
  app.viewer.dispose();
});


test('The cached thumbnail is visible immediately and originals are promoted only after full decoding', async () => {
  const bitmap = { width: 320, height: 400 }; let finish;
  const app = scene({ getCoverPreview: path => path === 'front.png' ? bitmap : null });
  app.viewer.update(game, artwork); app.flush();
  const front = app.face('front'), image = front.children[1], preview = front.children[2];
  const spine = app.face('left').children[1], back = app.face('back').children[1];
  assert.equal(preview.tag, 'canvas'); assert.equal(preview.width, 320); assert.equal(preview.height, 400);
  assert.equal(preview.style.top, image.style.top); assert.equal(front.children[0].hidden, true);
  assert.equal(image.fetchPriority, 'high'); assert.equal(spine.fetchPriority, 'low');
  assert.equal(image.src, 'asset:front.png'); assert.equal(spine.src, undefined); assert.equal(back.src, undefined);
  image.decode = () => new Promise(resolve => { finish = resolve; }); image.onload();
  assert.equal(front.children.includes(preview), true); assert.equal(spine.src, undefined);
  finish(); await turn();
  assert.equal(image.classList.contains('loaded'), true); assert.equal(front.children.includes(preview), false); assert.equal(preview.width, 0);
  assert.equal(spine.src, 'asset:spine.png'); assert.equal(back.src, 'asset:back.png');
  assert.equal(bitmap.width, 320, 'the borrowed catalog thumbnail is never released or modified'); app.viewer.dispose();
});

test('A failed cover retains its thumbnail and releases other textures; stale decodes cannot change another game', async () => {
  const bitmap = { width: 300, height: 400 }, app = scene({ getCoverPreview: () => bitmap });
  app.viewer.update(game, artwork); const image = app.face('front').children[1], preview = app.face('front').children[2];
  image.onerror(); assert.equal(app.face('left').children[1].src, 'asset:spine.png'); assert.equal(preview.width, 300);
  app.viewer.update({ ...game, id: 2 }, artwork); assert.equal(preview.width, 0);
  const second = app.face('front').children[1], oldSpine = app.face('left').children[1]; let finish;
  second.decode = () => new Promise(resolve => { finish = resolve; }); second.onload();
  app.viewer.update({ ...game, id: 3 }, artwork); const thirdPreview = app.face('front').children[2];
  finish(); await turn(); assert.equal(oldSpine.src, '');
  assert.equal(app.face('front').children[2], thirdPreview); assert.ok(thirdPreview.width);
  app.viewer.dispose(); assert.equal(thirdPreview.width, 0); assert.equal(bitmap.width, 300);
  const noCover = scene(); noCover.viewer.update(game, [{ kind: 'spine', path: 'spine.png' }]);
  assert.equal(noCover.face('left').children[1].src, 'asset:spine.png'); noCover.viewer.dispose();
});

test('Opening animates rigid assemblies without rewriting face dimensions or transforms every frame', () => {
  const app = scene({ trackStyles: true }); app.viewer.update(game, artwork); app.flush(0);
  app.viewer.setOpen(true); app.flush(0);
  const faces = app.elements().filter(e => e.className.startsWith('game-box-face'));
  const geometryWrites = () => faces.reduce((sum, e) => sum + e.styleWrites.filter(name => ['width','height','left','top','transform'].includes(name)).length, 0);
  const before = geometryWrites(), frontWidth = app.face('front').style.width;
  app.flush(160); app.flush(325); app.flush(500); app.flush(650); app.flush(700);
  assert.equal(geometryWrites(), before); assert.equal(app.face('front').style.width, frontWidth);
  assert.match(app.face('front').parentNode.style.transform, /rotateY\(-170deg\)/);
  assert.equal(app.frames.size, 0);
  app.host.rect = { width: 1600, height: 1000 }; app.observer.callback(); app.flush(750);
  assert.ok(parseFloat(app.face('front').style.width) > parseFloat(frontWidth), 'fullscreen regenerates geometry at its real pixel size');
  assert.ok(geometryWrites() > before); app.viewer.dispose();
});

test('Rotating an open PS2 booklet reuses its textures and geometry without per-frame layout reads', async () => {
  const data = booklet(); data.front.width = 1366; data.front.height = 2048;
  const app = scene({ trackStyles: true, loadManual: async () => data });
  app.viewer.update(game, artwork); app.flush(0); await turn();
  app.viewer.setOpen(true, false); app.flush(100);
  const faces = app.elements().filter(e => e.className.startsWith('game-box-face'));
  assert.ok(faces.length < 950, `the detailed interior must stay within its compositing budget (${faces.length} faces)`);
  const front = faces.find(e => e.className.endsWith('manual-front'));
  const geometryWrites = () => faces.reduce((sum,e) => sum + e.styleWrites.filter(name => ['width','height','left','top','transform'].includes(name)).length,0);
  const before = geometryWrites(), reads = app.host.boundsReads;
  const originalTransform = app.model().style.transform;
  for (let i=0;i<60;i++) { app.host.trigger('keydown',{ key:'ArrowRight' }); app.flush(150+i*40); }
  app.flush(2600);
  // 60 x 15 degrees ends at the opposite side, with every face still reused.
  assert.notEqual(app.model().style.transform,originalTransform);
  assert.equal(geometryWrites(),before); assert.equal(app.host.boundsReads,reads);
  assert.equal(front.children[0],data.front); assert.equal(data.front.width,1366); assert.equal(data.front.height,2048);
  assert.equal(front.style['--box-reflection-angle'],undefined);
  assert.equal(front.style['--box-reflection-x'],undefined);
  assert.equal(front.style['--box-gloss'],undefined, 'paper only updates the shading it actually uses');
  assert.equal(app.frames.size,0); assert.equal(data.disposed(),0);
  app.host.rect = { width:1600,height:1000 }; app.observer.callback(); app.flush(2700);
  assert.equal(app.host.boundsReads,reads+1); assert.ok(geometryWrites()>before);
  assert.equal(front.children[0],data.front); app.viewer.dispose(); assert.equal(data.disposed(),1);
});
