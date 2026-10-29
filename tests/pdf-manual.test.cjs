const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('./helpers/localized-vm.cjs');

function fixture({ pages = 37, width = 400, height = 600, sizes = {}, failure, wait, draw } = {}) {
  const canvases = [], requested = [], argumentsList = []; let destroyed = 0, cleaned = 0;
  const context = vm.createContext({ URL, DOMException, AbortController, document: {
    baseURI: 'http://tauri.localhost/index.html',
    createElement(tag) {
      assert.equal(tag, 'canvas'); const canvas = { width: 0, height: 0, getContext() { return { canvas }; } };
      canvases.push(canvas); return canvas;
    },
  } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/pdf-manual.js'), 'utf8'), context);
  const library = { getDocument(args) {
    argumentsList.push(args);
    return { destroy: async () => { destroyed++; }, promise: (async () => {
      if (wait) await wait; if (failure) throw new Error(failure);
      return { numPages: pages, async getPage(page) {
        requested.push(page);
        const [pageWidth,pageHeight]=sizes[page]||[width,height];
        return { getViewport: ({ scale }) => ({ width: pageWidth * scale, height: pageHeight * scale }), cleanup: () => { cleaned++; },
          render: options => ({ promise: draw ? draw(page, options) : Promise.resolve(), cancel() {} }) };
      } };
    })() };
  } };
  return { api: context.OpenCabinetManualPDF, canvases, requested, argumentsList,
    destroyed: () => destroyed, cleaned: () => cleaned,
    open: (options = {}) => context.OpenCabinetManualPDF.open('C:/manual.pdf', { imageSource: value => 'asset:' + value, loadLibrary: async () => library, ...options }),
    render: (options = {}) => context.OpenCabinetManualPDF.render('C:/manual.pdf', { imageSource: value => 'asset:' + value, loadLibrary: async () => library, ...options }) };
}

test('The back preview loads only the final page on demand and owns its canvas until disposal',async()=>{
  const app=fixture({pages:37}),data=await app.render();
  assert.deepEqual(app.requested,[1]);assert.equal(data.back,undefined);
  const [a,b]=await Promise.all([data.loadBack(),data.loadBack()]);
  assert.equal(a,b);assert.equal(data.back,a);assert.deepEqual(app.requested,[1,37]);
  assert.equal(app.destroyed(),2);assert.ok(a.width>0);assert.ok(data.front.width>0);
  assert.equal(await data.loadBack(),a);assert.deepEqual(app.requested,[1,37]);
  data.dispose();assert.equal(a.width,0);assert.equal(data.front.width,0);
  await assert.rejects(data.loadBack(),error=>error.name==='AbortError');
});

test('Automatic reading splits consecutive interior spreads while keeping narrow PSP covers intact',async()=>{
  const drawings=[],app=fixture({pages:14,width:486,height:481.536,
    sizes:{1:[245.661,481.402],14:[242.746,484.143]},draw:(page,options)=>{drawings.push({page,options});}});
  const preview=await app.render();assert.equal(preview.splitCover,false);assert.deepEqual(app.requested,[1]);preview.dispose();
  const doc=await app.open({layout:'auto'});
  assert.equal(doc.layout,'spreads');assert.equal(doc.sourcePageCount,14);assert.equal(doc.pageCount,26);
  assert.ok(Math.abs(doc.aspectRatio-245.661/481.402)<1e-9);
  assert.equal(drawings.length,1,'metadata inspection must not rasterize any reading pages');
  for(const page of [1,2,3,4,25,26])await doc.renderPage(page,{maxSide:1024});
  assert.deepEqual(drawings.slice(1).map(d=>[d.page,Boolean(d.options.transform)]),[[1,false],[2,false],[2,true],[3,false],[13,true],[14,false]]);
  for(const {options} of drawings.slice(2,6))assert.equal(options.canvasContext.canvas.width,Math.ceil(options.viewport.width/2));
  assert.equal(drawings.at(-1).options.canvasContext.canvas.width,Math.ceil(drawings.at(-1).options.viewport.width));
  doc.dispose();
});

test('Automatic reading keeps portrait pages and isolated landscape diagrams in their original order',async()=>{
  const drawings=[],app=fixture({pages:10,sizes:{2:[800,600]},draw:(page,options)=>drawings.push({page,options})});
  const doc=await app.open({layout:'auto'});assert.equal(doc.layout,'original');assert.equal(doc.pageCount,10);
  await doc.renderPage(2);assert.equal(drawings[0].options.transform,undefined);
  assert.equal(drawings[0].options.canvasContext.canvas.width,Math.ceil(drawings[0].options.viewport.width));doc.dispose();
  const single=await fixture({pages:1}).open({layout:'auto'});assert.equal(single.pageCount,1);assert.equal(single.layout,'original');single.dispose();
});

test('Automatic imposed covers and explicit sequential spreads use distinct page orders',async()=>{
  const app=fixture({pages:4,width:1200,height:900}),imposed=await app.open({layout:'auto'});
  assert.equal(imposed.layout,'booklet');assert.equal(imposed.pageCount,8);imposed.dispose();
  const drawings=[],sequential=fixture({pages:2,width:1200,height:900,draw:(page,options)=>drawings.push([page,Boolean(options.transform)])});
  const doc=await sequential.open({layout:'spreads'});assert.equal(doc.pageCount,4);
  for(const page of [1,2,3,4])await doc.renderPage(page);
  assert.deepEqual(drawings,[[1,false],[1,true],[2,false],[2,true]]);doc.dispose();
});

test('A folded back preview uses the opposite half of the first scan, not the last physical scan',async()=>{
  for(const coverMode of ['right','left']) {
    const draws=[],app=fixture({pages:12,width:800,height:600,draw:(page,options)=>{draws.push(options);return Promise.resolve();}});
    const data=await app.render({coverMode});await data.loadBack();
    assert.deepEqual(app.requested,[1,1]);assert.equal(draws.length,2);
    assert.equal(Boolean(draws[0].transform),coverMode==='right');
    assert.equal(Boolean(draws[1].transform),coverMode==='left');
    data.dispose();
  }
});

test('A single-page manual reuses its sole page and pending back previews cannot survive disposal',async()=>{
  const single=fixture({pages:1}),one=await single.render();assert.equal(await one.loadBack(),one.front);
  assert.deepEqual(single.requested,[1]);one.dispose();
  let finish;
  const app=fixture({pages:7,draw:page=>page===7?new Promise(resolve=>{finish=resolve;}):Promise.resolve()}),data=await app.render();
  const back=data.loadBack();while(!finish)await new Promise(resolve=>setImmediate(resolve));
  data.dispose();finish();await assert.rejects(back,error=>error.name==='AbortError');
  assert.equal(data.back,undefined);assert.ok(app.canvases.every(canvas=>canvas.width===0));
});

test('PS2 booklet dimensions preserve page proportions and fit the inside of the case', () => {
  const { api } = fixture(); const profile = { width: 135, height: 190 };
  for (const ratio of [0.42, 0.60, 0.65, 0.8, 1.5]) {
    const info = api.dimensions(profile, { aspectRatio: ratio, pageCount: 45 });
    assert.ok(info.height <= 184); assert.ok(info.width <= 121 + 1e-9);
    assert.ok(Math.abs(info.width / info.height - ratio) < 1e-9);
    assert.ok(Math.abs(info.x + info.width / 2 - 59.5) < 1e-9, 'booklets tuck under the same retaining tongues');
    if (ratio < 0.65) assert.equal(info.height, 184);
    assert.equal(info.sheets, 23);
  }
  assert.ok(api.dimensions(profile, { aspectRatio: .6, pageCount: 80 }).thickness > api.dimensions(profile, { aspectRatio: .6, pageCount: 8 }).thickness);
  assert.ok(api.dimensions(profile, { aspectRatio: .6, pageCount: 2000 }).thickness <= 3.4);
  assert.throws(() => api.dimensions(profile, { aspectRatio: NaN, pageCount: 10 }));
  assert.throws(() => api.dimensions(profile, { aspectRatio: .6, pageCount: 0 }));
  assert.equal(api.isPS2({ platform: 'Sony PlayStation 2' }), true);
  assert.equal(api.isPS2({ platform: 'PS2' }), true);
  assert.equal(api.isPS2({ platform: 'PlayStation 3' }), false);
});

test('PSP manuals are supported and fill the lid height while preserving narrow page proportions', () => {
  const {api}=fixture();
  for(const platform of ['PSP','Sony PSP','PlayStation Portable','Sony PlayStation Portable'])assert.equal(api.supportsGame({platform}),true);
  assert.equal(api.supportsGame({platform:'PS4'}),false);
  const profile={id:'psp',width:99,height:168};
  const narrow=api.dimensions(profile,{aspectRatio:.51,pageCount:14});
  assert.equal(narrow.height,162);assert.ok(Math.abs(narrow.width/narrow.height-.51)<1e-9);
  assert.ok(Math.abs(narrow.x+narrow.width/2-(profile.width/2-3))<1e-9);
  const wide=api.dimensions(profile,{aspectRatio:1.2,pageCount:40});
  assert.ok(wide.width<=93);assert.ok(wide.height<=162);assert.ok(Math.abs(wide.width/wide.height-1.2)<1e-9);
});

test('DVD, DS, GameCube and PS3 manuals preserve their page proportions and respect lid clearances',()=>{
  const {api}=fixture();
  for(const platform of ['Xbox','Microsoft Xbox','Xbox 360','Microsoft Xbox 360','DS','Nintendo DS','GameCube','Nintendo GameCube','Wii','Nintendo Wii','Wii U','Nintendo Wii U','PS3','Sony PlayStation 3'])assert.equal(api.supportsGame({platform}),true,platform);
  for(const platform of ['Xbox One','Xbox Series X','Nintendo Switch','Nintendo 3DS','PS5','Sega Genesis'])assert.equal(api.supportsGame({platform}),false,platform);
  for(const profile of [
    {id:'dvd',variant:'xbox',width:135,height:190},
    {id:'dvd',variant:'xbox360',width:135,height:190},
    {id:'dvd',variant:'wii',width:135,height:190},
    {id:'dvd',variant:'wiiu',width:135,height:190},
    {id:'dvd',variant:'gamecube',width:135,height:190},
    {id:'gameCubeJapan',variant:'gamecube',width:107,height:149},
    {id:'ds',variant:'ds',width:135,height:122},
    {id:'dsPal',variant:'ds',width:135,height:122},
    {id:'bluray',variant:'ps3',width:135,height:171,headerHeight:14},
  ])for(const ratio of [.45,.65,1.03,1.4]){
    const size=api.dimensions(profile,{aspectRatio:ratio,pageCount:40}),header=profile.headerHeight||0;
    assert.ok(Math.abs(size.width/size.height-ratio)<1e-9);
    assert.ok(size.y-size.height/2>=-profile.height/2+header+3-1e-9,'paper stays below the header');
    assert.ok(size.y+size.height/2<=profile.height/2-3+1e-9,'paper stays inside the lower rim');
    assert.ok(size.x-size.width/2>=-profile.width/2+3-1e-9);
    if(['ds','gamecube'].includes(profile.variant))assert.ok(size.x+size.width/2<profile.width/2-10.375,'paper stops before the security divider');
  }
});

test('Box previews request only page 1 even for long PDFs, and release PDF resources before returning', async () => {
  const app = fixture({ pages: 137, width: 2000, height: 3000 }); const data = await app.render();
  assert.deepEqual(app.requested, [1]); assert.equal(data.pageCount, 137); assert.equal(data.aspectRatio, 2/3);
  assert.equal(app.destroyed(), 1); assert.equal(app.cleaned(), 1);
  assert.equal(app.canvases.length, 1); assert.equal(data.front, app.canvases[0]); assert.equal(data.back, undefined);
  assert.ok(app.canvases.every(canvas => canvas.width > 0 && canvas.height <= 2048));
  assert.equal(app.argumentsList[0].url, 'asset:C:/manual.pdf');
  assert.equal(app.argumentsList[0].isEvalSupported, false);
  assert.match(app.argumentsList[0].wasmUrl, /^http:\/\/tauri.localhost\/vendor\/pdfjs\/wasm\/$/);
  data.dispose(); assert.ok(app.canvases.every(canvas => !canvas.width && !canvas.height));
});

test('DS splits a square-booklet cover spread without cutting a single square or slightly landscape cover',async()=>{
  const app=fixture({pages:24,width:1180,height:580}),data=await app.render({platform:'Nintendo DS'});
  assert.equal(data.platform,'Nintendo DS');
  assert.equal(data.splitCover,true);assert.ok(Math.abs(data.aspectRatio-59/58)<1e-9);
  assert.deepEqual(app.requested,[1]);assert.equal(data.front.width,Math.ceil(data.front.height*data.aspectRatio));data.dispose();
  for(const ratio of [1,1.1,1.25]){
    const single=fixture({width:ratio*600,height:600}),preview=await single.render({platform:'DS'});
    assert.equal(preview.splitCover,false);assert.equal(preview.aspectRatio,ratio);preview.dispose();
  }
  const explicit=await fixture({width:1180,height:580}).render({platform:'DS',coverMode:'full'});
  assert.equal(explicit.splitCover,false);explicit.dispose();
  const reading=await app.open({platform:'Nintendo DS',layout:'auto'});
  assert.equal(reading.layout,'booklet');assert.equal(reading.pageCount,48);reading.dispose();
  const single=await fixture({width:660,height:600}).open({platform:'DS',layout:'auto'});
  assert.equal(single.layout,'original');single.dispose();
});

test('Background manual previews rasterize only the cropped first page at the cache resolution',async()=>{
  const app=fixture({pages:200,width:1200,height:900});
  const preview=await app.render({coverMode:'right',maxSide:800});
  assert.deepEqual(app.requested,[1]);assert.equal(preview.front.height,800);assert.equal(preview.front.width,534);
  assert.equal(preview.pageCount,200);assert.equal(preview.splitCover,true);assert.equal(app.destroyed(),1);
  preview.dispose();assert.equal(preview.front.width,0);
});

test('A one-page PDF is rendered once and unreadable PDFs release their resources', async () => {
  const app = fixture({ pages: 1 }); const data = await app.render();
  assert.deepEqual(app.requested, [1]); assert.equal(app.canvases.length, 1); assert.equal(data.back, undefined); data.dispose();
  const bad = fixture({ failure: 'Invalid PDF' }); await assert.rejects(bad.render(), /Invalid PDF/); assert.equal(bad.destroyed(), 1);
});

test('Landscape cover spreads crop the right half directly without rendering other PDF pages', async () => {
  const drawings = [];
  const app = fixture({ width:1200,height:900,pages:100,draw: (_,options) => { drawings.push(options); } });
  const data = await app.render();
  assert.equal(data.splitCover,true); assert.equal(data.coverMode,'auto');
  assert.equal(data.sourceAspectRatio,4/3); assert.equal(data.aspectRatio,2/3);
  assert.deepEqual(app.requested,[1]); assert.equal(app.canvases.length,1);
  const drawing = drawings[0];
  assert.deepEqual(Array.from(drawing.transform),[1,0,0,1,-drawing.viewport.width/2,0]);
  assert.equal(data.front.width,Math.ceil(drawing.viewport.width/2));
  assert.equal(data.front.height,2048); assert.equal(app.destroyed(),1);
  data.dispose(); assert.equal(data.front.width,0);
});

test('Cover overrides support either half or the complete original page', async () => {
  for (const coverMode of ['left','right','full']) {
    let drawing;
    const app = fixture({ width:1200,height:900,draw: (_,options) => { drawing=options; } });
    const data = await app.render({ coverMode });
    assert.equal(data.coverMode,coverMode); assert.equal(data.splitCover,coverMode!=='full');
    assert.equal(data.aspectRatio,coverMode==='full'?4/3:2/3);
    assert.equal(data.front.width,Math.ceil(drawing.viewport.width/(coverMode==='full'?1:2)));
    assert.equal(Boolean(drawing.transform),coverMode==='right');
    assert.deepEqual(app.requested,[1]); data.dispose();
  }
});

test('Automatic cover detection preserves portrait, square and very wide foldouts', async () => {
  for (const ratio of [.5,2/3,.95,1,1.04,1.71,2.5]) {
    let drawing;
    const app = fixture({ width:900*ratio,height:900,draw: (_,options) => { drawing=options; } });
    const data = await app.render();
    assert.equal(data.splitCover,false); assert.equal(data.aspectRatio,ratio);
    assert.equal(drawing.transform,undefined); assert.deepEqual(app.requested,[1]); data.dispose();
  }
});

test('Switching games cancels PDF preparation and releases any pages already rendered', async () => {
  let resolve; const wait = new Promise(done => { resolve = done; });
  const app = fixture({ wait }); const controller = new AbortController();
  const pending = app.render({ signal: controller.signal }); await new Promise(done => setImmediate(done));
  controller.abort(); resolve(); await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(app.destroyed(), 1); assert.equal(app.canvases.length, 0);
  const during = new AbortController();
  const draw = fixture({ draw: () => { during.abort(); return Promise.resolve(); } });
  await assert.rejects(draw.render({ signal: during.signal }), error => error.name === 'AbortError');
  assert.equal(draw.destroyed(), 1); assert.ok(draw.canvases.every(canvas => !canvas.width && !canvas.height));
});


test('Reading sessions load a PDF once, draw only requested pages and release each canvas explicitly', async () => {
  const app = fixture(); const doc = await app.open();
  assert.equal(doc.pageCount, 37); assert.deepEqual(app.requested, []); assert.equal(app.destroyed(), 0);
  const fourth = await doc.renderPage(4); const second = await doc.renderPage(2, { maxSide: 100000 });
  assert.deepEqual(app.requested, [4, 2]); assert.equal(app.argumentsList.length, 1);
  assert.ok(Math.max(fourth.width, fourth.height) <= 3072); assert.ok(Math.max(second.width, second.height) <= 4096);
  doc.release(fourth); assert.equal(fourth.width, 0); assert.ok(second.width > 0);
  await assert.rejects(doc.renderPage(0), /página no existe/); await assert.rejects(doc.renderPage(38), /página no existe/);
  doc.dispose(); doc.dispose(); assert.equal(app.destroyed(), 1); assert.equal(second.width, 0);
  await assert.rejects(doc.renderPage(1), error => error.name === 'AbortError');
});

test('Folded sheet scans [8,1], [2,7], [6,3], [4,5] become eight correctly cropped reading pages', async () => {
  const drawn=[];
  const app=fixture({pages:4,width:1200,height:900,draw:(page,options)=>{drawn.push({page,options});}});
  const doc=await app.open({layout:'booklet'});
  assert.equal(doc.pageCount,8);assert.equal(doc.sourcePageCount,4);
  assert.deepEqual(app.requested,[],'opening the reader must not rasterize its pages');
  for(let number=1;number<=8;number++){
    const canvas=await doc.renderPage(number);
    assert.equal(canvas.width,2048);assert.equal(canvas.height,3072);
    doc.release(canvas);
  }
  assert.deepEqual(drawn.map(({page,options})=>[page,options.transform?'right':'left']),
    [[1,'right'],[2,'left'],[3,'right'],[4,'left'],[4,'right'],[3,'left'],[2,'right'],[1,'left']]);
  for(const {options}of drawn)if(options.transform)assert.equal(options.transform[4],-options.viewport.width/2);
  assert.ok(app.canvases.every(canvas=>canvas.width===0));doc.dispose();assert.equal(app.destroyed(),1);
});

test('Left-hand covers mirror the half selection without reversing the reading order',async()=>{
  const drawn=[];
  const app=fixture({pages:2,width:1200,height:900,draw:(page,options)=>drawn.push([page,options.transform?'right':'left'])});
  const doc=await app.open({layout:'booklet',coverSide:'left'});
  for(const number of [1,2,3,4])doc.release(await doc.renderPage(number));
  assert.deepEqual(drawn,[[1,'left'],[2,'right'],[2,'left'],[1,'right']]);doc.dispose();
});

test('Scans keeping the same side order [8,1], [7,2], [6,3], [5,4] can be reconstructed too',async()=>{
  const drawn=[];
  const app=fixture({pages:4,width:1200,height:900,draw:(page,options)=>drawn.push([page,options.transform?'right':'left'])});
  const doc=await app.open({layout:'nested'});
  assert.equal(doc.pageCount,8);
  for(let number=1;number<=8;number++)doc.release(await doc.renderPage(number));
  assert.deepEqual(drawn,[[1,'right'],[2,'right'],[3,'right'],[4,'right'],[4,'left'],[3,'left'],[2,'left'],[1,'left']]);
  doc.dispose();
});

test('Imposed reading supports single/odd scan counts and validates logical page numbers',async()=>{
  for(const scans of [1,3,7]){
    const app=fixture({pages:scans,width:1200,height:900});const doc=await app.open({layout:'booklet'});
    assert.equal(doc.pageCount,scans*2);
    await assert.rejects(doc.renderPage(scans*2+1),/página no existe/);
    doc.release(await doc.renderPage(scans*2));assert.deepEqual(app.requested,[1]);doc.dispose();
  }
});

test('Cancelling one half-page keeps the other half render and the reading session usable',async()=>{
  let fail=true;const cancelled=new AbortController();
  const app=fixture({pages:4,width:1200,height:900,draw:(_,options)=>{
    if(!options.transform&&fail){fail=false;cancelled.abort();}return Promise.resolve();
  }});
  const doc=await app.open({layout:'booklet'});
  const results=await Promise.allSettled([doc.renderPage(4,{signal:cancelled.signal}),doc.renderPage(5)]);
  assert.equal(results[0].status,'rejected');assert.equal(results[0].reason.name,'AbortError');
  assert.equal(results[1].status,'fulfilled');assert.ok(results[1].value.width>0);assert.equal(app.destroyed(),0);
  doc.release(results[1].value);doc.release(await doc.renderPage(4));doc.dispose();
  assert.ok(app.canvases.every(canvas=>!canvas.width));
});

test('Cancelling a page leaves the PDF available, while closing the session destroys its worker and textures', async () => {
  const page = new AbortController(); let first = true;
  const app = fixture({ draw: () => { if (first) { first = false; page.abort(); } return Promise.resolve(); } });
  const lifetime = new AbortController(); const doc = await app.open({ signal: lifetime.signal });
  await assert.rejects(doc.renderPage(2, { signal: page.signal }), error => error.name === 'AbortError');
  assert.equal(app.destroyed(), 0); assert.ok(app.canvases.every(canvas => !canvas.width));
  const third = await doc.renderPage(3); assert.ok(third.width > 0);
  lifetime.abort(); assert.equal(app.destroyed(), 1); assert.equal(third.width, 0);
});

test('Closing while the PDF is opening cancels its promise safely and corrupt documents remain recoverable', async () => {
  let finish; const wait = new Promise(resolve => { finish = resolve; });
  const app = fixture({ wait }); const controller = new AbortController();
  const pending = app.open({ signal: controller.signal }); await new Promise(resolve => setImmediate(resolve));
  controller.abort(); finish(); await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(app.destroyed(), 1); assert.deepEqual(app.requested, []);
  const bad = fixture({ failure: 'Corrupt PDF' }); await assert.rejects(bad.open(), /Corrupt PDF/); assert.equal(bad.destroyed(), 1);
});
