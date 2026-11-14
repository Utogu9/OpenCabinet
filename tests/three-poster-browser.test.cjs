const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');

test('Posters stay folded beneath booklets, unfold with paired artwork and share independent extracted-object focus',{timeout:180000},async t=>{
  const {chromium}=require('playwright-core'),base=path.resolve(__dirname,'..');
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium unavailable');return;}
  const server=http.createServer((req,res)=>{
    if(req.url==='/poster-local-fixture.jpg'&&process.env.OPENCABINET_POSTER_FIXTURE){res.setHeader('Content-Type','image/jpeg');fs.createReadStream(process.env.OPENCABINET_POSTER_FIXTURE).pipe(res);return;}
    const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(base,'.'+name);
    if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const ready=()=>page.waitForFunction(()=>document.getElementById('stage').dataset.discAnimation==='ready');
  const url=platform=>'http://127.0.0.1:'+server.address().port+'/tests/fixtures/three-disc.html?poster=1&manual=1&columns=3&rows=2&platform='+encodeURIComponent(platform);
  for(const platform of ['Sony PlayStation 2','Sega Dreamcast','Sony PlayStation 3','Nintendo DS','Sega Genesis']){
    await t.test(platform,async()=>{
      await page.goto(url(platform));await page.waitForFunction(()=>window.viewer?.hasManual&&window.debug?.renderer.info.render.calls>0);
      assert.equal(await page.evaluate(()=>viewer.hasPoster),false,'closed cases do not load poster scans');
      await page.evaluate(()=>viewer.setOpen(true,false));await page.waitForFunction(()=>viewer.hasPoster);
      assert.equal(await page.evaluate(()=>viewer.canRemovePoster),false,'the manual covers the folded poster');
      assert.equal(await page.evaluate(()=>viewer.removePoster()),false,'covered posters cannot be extracted through the booklet');
      const proportions=await page.evaluate(async()=>{
        const THREE=await import('/src/vendor/three/three.module.js'),poster=debug.poster.front;
        debug.scene.updateMatrixWorld(true);
        const shape=mesh=>{mesh.geometry.computeBoundingBox();const size=mesh.geometry.boundingBox.getSize(new THREE.Vector3()),scale=new THREE.Vector3();mesh.matrixWorld.decompose(new THREE.Vector3(),new THREE.Quaternion(),scale);return size.x*Math.abs(scale.x)/(size.y*Math.abs(scale.y));};
        const manual=debug.manualMeshes?.[1]||debug.meshes.find(mesh=>mesh.material===debug.materials.cover);
        return {poster:shape(poster),manual:shape(manual)};
      });
      assert.ok(Math.abs(proportions.poster-proportions.manual)<1e-5,'the folded poster has the same aspect ratio as this console booklet '+JSON.stringify(proportions));
      await page.evaluate(()=>viewer.removeManual());await ready();await page.waitForFunction(()=>viewer.canRemovePoster);
      await page.evaluate(()=>viewer.examineBox());await ready();
      if(platform==='Sony PlayStation 2')await page.screenshot({path:'target/poster-folded-ps2.png'});
      const point=await page.evaluate(async()=>{
        const THREE=await import('/src/vendor/three/three.module.js');debug.scene.updateMatrixWorld(true);
        const bounds=new THREE.Box3().setFromObject(debug.poster.root),p=bounds.getCenter(new THREE.Vector3()).project(debug.camera),r=document.querySelector('#stage canvas').getBoundingClientRect();
        return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
      });
      await page.mouse.click(point.x,point.y);await page.waitForFunction(()=>viewer.isPosterRemoved);await ready();
      assert.equal(await page.locator('#stage').getAttribute('data-disc-focus'),'poster');
      const folded=await page.evaluate(async()=>{
        const THREE=await import('/src/vendor/three/three.module.js'),object=debug.discInteraction.posterObject;
        const box=new THREE.Box3();for(const mesh of object.children[0].children){mesh.geometry.computeBoundingBox();box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix));}
        return {size:box.getSize(new THREE.Vector3()).toArray(),meshes:object.children[0].children.length,manualScale:debug.manualGroup?.scale.toArray()};
      });
      assert.equal(folded.meshes,18,'3 × 2 parts share front, back and paper edges');
      await page.getByRole('button',{name:'poster.unfold',exact:true}).click();await page.waitForFunction(()=>!debug.poster.animating);
      const flat=await page.evaluate(async()=>{
        const THREE=await import('/src/vendor/three/three.module.js'),box=new THREE.Box3(),copies=debug.discInteraction.posterObject.children[0].children;
        for(const mesh of copies)box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix));
        const rotation=new THREE.Quaternion();copies[0].matrix.decompose(new THREE.Vector3(),rotation,new THREE.Vector3());rotation.invert();
        const aligned=new THREE.Box3();
        for(const mesh of copies){const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++)aligned.expandByPoint(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrix).applyQuaternion(rotation));}
        const size=aligned.getSize(new THREE.Vector3());
        return {size:box.getSize(new THREE.Vector3()).toArray(),aspect:size.x/size.y,front:copies[0].material.map.image.width,back:copies[1].material.map.image.width};
      });
      assert.ok(flat.size[0]>folded.size[0]*2.9&&flat.size[1]>=folded.size[1]*.999,'the entire sheet unfolds beyond the original folded footprint '+JSON.stringify({folded,flat}));
      assert.ok(Math.abs(flat.aspect-1.5)<1e-5,'the unfolded poster keeps the original scan aspect ratio '+JSON.stringify(flat));
      assert.equal(flat.front,900);assert.equal(flat.back,256);
      const viewport=await page.locator('#stage').boundingBox();
      const panSnapshot=()=>page.evaluate(async()=>{
        const THREE=await import('/src/vendor/three/three.module.js');
        return {point:new THREE.Vector3().project(debug.camera).toArray(),box:debug.root.quaternion.toArray(),poster:debug.discInteraction.posterObject.quaternion.toArray(),manual:debug.discInteraction.manualObject.quaternion.toArray(),focus:document.querySelector('#stage').dataset.discFocus};
      });
      const beforePan=await panSnapshot(),x=viewport.x+viewport.width*.6,y=viewport.y+viewport.height*.45;
      await page.mouse.move(x,y);await page.mouse.down({button:'middle'});await page.mouse.move(x+60,y+40,{steps:3});await page.mouse.up({button:'middle'});
      await page.waitForFunction(previous=>Math.abs(new Float64Array(debug.camera.projectionMatrix.elements)[8]-previous)>1e-5,-beforePan.point[0]);
      const afterPan=await panSnapshot();
      assert.ok(Math.abs((afterPan.point[0]-beforePan.point[0])*viewport.width/2-60)<1,'middle drag shifts the camera view horizontally');
      assert.ok(Math.abs((beforePan.point[1]-afterPan.point[1])*viewport.height/2-40)<1,'middle drag shifts the camera view vertically');
      for(const key of ['box','poster','manual','focus'])assert.deepEqual(afterPan[key],beforePan[key],'panning never rotates or selects objects');
      await page.mouse.down({button:'middle'});await page.mouse.move(x,y,{steps:3});await page.mouse.up({button:'middle'});
      const manualRotation=await page.evaluate(()=>debug.discInteraction.manualObject.quaternion.toArray());
      await page.evaluate(async()=>{viewer.rotate(25,15);viewer.zoom(.2);await settle();});
      assert.deepEqual(await page.evaluate(()=>debug.discInteraction.manualObject.quaternion.toArray()),manualRotation);
      await page.evaluate(async()=>{viewer.toggleSide();await settle();});
      assert.equal(await page.locator('#stage').getAttribute('data-disc-focus'),'poster');
      if(platform==='Sony PlayStation 2')await page.screenshot({path:'target/poster-unfolded-ps2.png'});
      if(await page.evaluate(()=>viewer.hasDisc)){await page.evaluate(()=>viewer.removeDisc());await ready();assert.equal(await page.evaluate(()=>viewer.isPosterRemoved&&viewer.isManualRemoved&&viewer.isDiscRemoved),true);}
      await page.evaluate(()=>viewer.putPosterBack());await page.waitForFunction(()=>!viewer.isPosterRemoved);
      assert.equal(await page.evaluate(()=>viewer.isPosterUnfolded),false,'posters fold before going back into the case');
      assert.equal(await page.evaluate(()=>viewer.isManualRemoved),true,'reinserting a poster leaves the manual outside');
      await page.evaluate(()=>viewer.putManualBack());await page.waitForFunction(()=>!viewer.isManualRemoved);
      assert.equal(await page.evaluate(()=>viewer.canRemovePoster),false,'the returned manual hides the poster again');
      assert.equal(await page.evaluate(()=>debug.renderer.getContext().getError()),0);
      await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);
    });
  }
  await page.goto(url('Sony PlayStation 2').replace('&manual=1','').replace('poster=1','poster=front'));await page.waitForFunction(()=>window.debug?.renderer.info.render.calls>0);
  if(process.env.OPENCABINET_POSTER_FIXTURE)await page.evaluate(()=>{art.find(image=>image.kind==='poster_front').path='/poster-local-fixture.jpg';select(3);});
  await page.evaluate(()=>viewer.setOpen(true,false));await page.waitForFunction(()=>viewer.canRemovePoster);
  assert.equal(await page.evaluate(()=>viewer.hasManual),false,'posters also work without a PDF or CBZ');
  assert.equal(await page.evaluate(()=>debug.poster.meshes[1].material.map===null),true,'missing reverse artwork leaves a plain paper back');
  const outside=await page.evaluate(async()=>{
    const THREE=await import('/src/vendor/three/three.module.js');debug.scene.updateMatrixWorld(true);
    const face=debug.poster.front,geometry=face.geometry;geometry.computeBoundingBox();const local=geometry.boundingBox.getCenter(new THREE.Vector3());
    const normal=new THREE.Vector3(0,0,1).transformDirection(face.matrixWorld),point=face.localToWorld(local),ray=new THREE.Raycaster(point.clone().addScaledVector(normal,50),normal.clone().negate());
    const first=ray.intersectObjects(debug.poster.meshes,false)[0];return {printed:!!first?.object.material.map,isFront:first?.object.material===face.material};
  });
  assert.equal(outside.printed&&outside.isFront,true,'a front-only scan stays visible while folded instead of showing a white reverse');
  if(process.env.OPENCABINET_POSTER_FIXTURE)await page.screenshot({path:'target/poster-local-fixture-folded.png'});
  await page.evaluate(()=>{viewer.removePoster();select(2);});assert.equal(await page.evaluate(()=>debug.discInteraction.posterObject.visible),false);
  // The current San Andreas example uses exactly 3 x 3 parts and a portrait booklet.
  await page.goto(url('Sony PlayStation 2').replace('rows=2','rows=3').replace('poster=1','poster=front')+'&manual-ratio='+(1023/1620));
  await page.waitForFunction(()=>viewer.hasManual);
  if(process.env.OPENCABINET_POSTER_FIXTURE)await page.evaluate(()=>{art.find(image=>image.kind==='poster_front').path='/poster-local-fixture.jpg';select(3);});
  else await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=258;canvas.height=320;const context=canvas.getContext('2d');context.fillStyle='#168140';context.fillRect(0,0,258,320);art.find(image=>image.kind==='poster_front').path=canvas.toDataURL();select(3);});
  await page.waitForFunction(()=>viewer.hasManual);await page.evaluate(()=>viewer.setOpen(true,false));await page.waitForFunction(()=>viewer.hasPoster);
  assert.equal(await page.evaluate(()=>debug.poster.meshes.length),27,'San Andreas keeps all nine requested panels');
  const portrait=await page.evaluate(async()=>{
    const THREE=await import('/src/vendor/three/three.module.js'),mesh=debug.poster.front;
    mesh.geometry.computeBoundingBox();const size=mesh.geometry.boundingBox.getSize(new THREE.Vector3());return size.x/size.y;
  });
  assert.ok(Math.abs(portrait-1023/1620)<1e-5,'a portrait PS2 booklet determines the folded poster proportions');
  await page.evaluate(()=>viewer.removeManual());await ready();await page.evaluate(()=>viewer.examineBox());await ready();
  if(process.env.OPENCABINET_POSTER_FIXTURE)await page.screenshot({path:'target/poster-local-fixture-booklet-folded.png'});
  await page.evaluate(()=>viewer.removePoster());await ready();
  assert.ok(await page.evaluate(()=>debug.discInteraction.posterObject.children[0].children.every(mesh=>mesh.visible)),'the extracted packet uses the complete physical sheet, without hidden paper faces');
  await page.evaluate(()=>viewer.togglePoster());await page.waitForFunction(()=>!debug.poster.animating);
  assert.ok(await page.evaluate(()=>debug.discInteraction.posterObject.children[0].children.every(mesh=>mesh.visible)),'the full sheet remains present when unfolded');
  if(process.env.OPENCABINET_POSTER_FIXTURE)await page.screenshot({path:'target/poster-local-fixture-booklet-unfolded.png'});
  await page.evaluate(()=>viewer.togglePoster());await page.waitForFunction(()=>!debug.poster.animating);
  assert.ok(await page.evaluate(()=>debug.discInteraction.posterObject.children[0].children.every(mesh=>mesh.visible)),'refolding uses the actual geometry without hiding its reverse');
  await page.evaluate(async()=>{viewer.toggleSide();await settle();});
  if(process.env.OPENCABINET_POSTER_FIXTURE)await page.screenshot({path:'target/poster-san-andreas-folded-rear.png'});
  const reversePrinted=await page.evaluate(async()=>{
    const THREE=await import('/src/vendor/three/three.module.js'),copies=debug.discInteraction.posterObject.children[0].children;
    const box=host=>{for(let n=host;n;n=n.parent)if(!n.visible)return false;return true;};
    debug.scene.updateMatrixWorld(true);const projected=debug.discInteraction.posterObject.getWorldPosition(new THREE.Vector3()).project(debug.camera),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(projected.x,projected.y),debug.camera);
    const hit=ray.intersectObjects(copies.filter(box),false)[0];return {printed:!!hit?.object.material.map,materialIsFront:hit?.object.material===debug.poster.front.material};
  });
  assert.deepEqual(reversePrinted,{printed:true,materialIsFront:true},'the rear of the folded San Andreas packet is a genuine printed front panel');
  for(const [columns,rows] of [[1,1],[2,5],[5,2],[8,3]]){
    await page.evaluate(([columns,rows])=>{window.posterOptions={columns,rows};select(3);viewer.setOpen(true,false);},[columns,rows]);
    await page.waitForFunction(()=>viewer.hasPoster);
    assert.equal(await page.evaluate(()=>debug.poster.meshes.length),columns*rows*3,'configured grid remains exact: '+columns+' x '+rows);
  }
  await page.goto(url('Sony PlayStation 2'));await page.waitForFunction(()=>viewer.hasManual);
  await page.evaluate(()=>{window.posterOptions={rotation:90,corner:'bottom_right',first_side:'back',fold_order:'columns_first'};select(5);viewer.setOpen(true,false);});
  await page.waitForFunction(()=>viewer.hasPoster);
  assert.deepEqual(await page.evaluate(()=>({outside:debug.poster.front.material.map.image.width,inside:debug.poster.meshes[1].material.map.image.width})),{outside:256,inside:900},'the selected reverse scan stays outside while the front remains on the other side');
  await page.evaluate(()=>viewer.removeManual());await ready();await page.evaluate(()=>viewer.removePoster());await ready();
  await page.evaluate(()=>viewer.togglePoster());await page.waitForFunction(()=>!debug.poster.animating);
  assert.equal(await page.evaluate(()=>debug.renderer.getContext().getError()),0);
  await page.evaluate(()=>{window.posterOptions={first_side:'front'};select(5);viewer.setOpen(true,false);});
  await page.waitForFunction(()=>viewer.hasPoster);
  assert.equal(await page.evaluate(()=>debug.poster.front.material.map.image.width),900,'editing only poster options refreshes an existing game without changing its artwork or box style');
  await page.evaluate(()=>viewer.dispose());assert.deepEqual(errors,[]);

  const html=fs.readFileSync(path.join(base,'src/index.html'),'utf8'),panel=html.match(/<section class="hidden" id="game-edit-panel-posters"[\s\S]*?<\/section>/)[0];
  await page.setContent('<link rel="stylesheet" href="http://127.0.0.1:'+server.address().port+'/src/styles.css"><div id="game-editor-panels" style="width:700px;padding:24px">'+panel+'</div>');
  await page.addScriptTag({url:'http://127.0.0.1:'+server.address().port+'/src/poster-settings.js'});
  await page.evaluate(messages=>{
    window.OpenCabinetI18n={t:(key,...values)=>(messages[key]||key).replace(/\{(\d+)\}/g,(token,index)=>index<values.length?String(values[index]):token)};
    document.querySelector('#game-edit-panel-posters').classList.remove('hidden');
    document.querySelectorAll('[data-i18n]').forEach(node=>{node.textContent=messages[node.dataset.i18n];});
    const canvas=document.createElement('canvas');canvas.width=300;canvas.height=450;const context=canvas.getContext('2d');context.fillStyle='#287b42';context.fillRect(0,0,300,450);
    let images=[{kind:'poster_front',path:canvas.toDataURL()}];
    window.posterFixtureImages=()=>images;
    window.addPosterFixture=()=>{const c=document.createElement('canvas');c.width=256;c.height=128;c.getContext('2d').fillStyle='#993322';c.getContext('2d').fillRect(0,0,256,128);images.push({kind:'poster_front',path:c.toDataURL()});editor.render();};
    window.editor=OpenCabinetPosters.createEditor({getImages:()=>images,setImages:value=>{images=value;editor.render();},imageSource:value=>value,addImages:kind=>{window.addedPosterKind=kind;}});
    editor.open({poster:{columns:3,rows:2,rotation:90,first_side:'back',corner:'bottom_right',fold_order:'columns_first'}});
  },JSON.parse(fs.readFileSync(path.join(base,'src/locales/en-US.json'),'utf8')).messages);
  await page.locator('#game-poster-columns').fill('4');
  await page.locator('#game-poster-add-back').click();assert.equal(await page.evaluate(()=>addedPosterKind),'poster_back');
  assert.deepEqual(await page.evaluate(()=>editor.value()[0].settings),{columns:4,rows:2,rotation:90,corner:'bottom_right',first_side:'back',fold_order:'columns_first'});
  await page.evaluate(()=>addPosterFixture());
  const second=await page.locator('#game-poster-select option').nth(1).getAttribute('value');
  await page.locator('#game-poster-select').selectOption(second);await page.locator('#game-poster-name').fill('Map');
  await page.locator('#game-poster-rows').fill('3');await page.locator('#game-poster-up').click();
  const paired=await page.evaluate(()=>editor.value());assert.equal(paired.length,2);assert.equal(paired[0].name,'Map');assert.equal(paired[0].settings.rows,3);assert.equal(paired[1].settings.columns,4);
  await page.locator('#game-poster-remove').click();assert.equal(await page.evaluate(()=>editor.value().length),1);
  assert.equal(await page.evaluate(()=>posterFixtureImages().length),2,'removing the pairing keeps both source scans');
  await page.locator('#game-poster-remove').click();assert.deepEqual(await page.evaluate(()=>editor.value()),[]);
  await page.locator('#game-poster-new').click();
  const source=await page.evaluate(()=>posterFixtureImages()[0].path);await page.locator('#game-poster-image-select-front').selectOption(source);
  assert.equal(await page.evaluate(()=>editor.value()[0].front),source);
  await page.screenshot({path:'target/poster-editor.png'});
});
