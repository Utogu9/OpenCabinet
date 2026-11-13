const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');

test('Manuals can be inspected outside their cases, share focus with discs and return without opening a reader',{timeout:180000},async t=>{
  const {chromium}=require('playwright-core'),base=path.resolve(__dirname,'..');
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium unavailable');return;}
  const server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(base,'.'+name);
    if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const ready=()=>page.waitForFunction(()=>document.getElementById('stage').dataset.discAnimation==='ready');
  async function shadowCoverage(label){
    const coverage=await page.evaluate(async()=>{
      const THREE=await import('/src/vendor/three/three.module.js'),light=debug.scene.children.find(node=>node.isDirectionalLight&&node.castShadow);
      if(!light)return null;debug.scene.updateMatrixWorld(true);const point=new THREE.Vector3();let count=0,outside=0;
      for(const mesh of debug.meshes){
        if(!mesh.visible)continue;
        for(let i=0;i<mesh.geometry.attributes.position.count;i+=37){
          mesh.getVertexPosition(i,point);point.applyMatrix4(mesh.matrixWorld).project(light.shadow.camera);count++;
          if(Math.max(Math.abs(point.x),Math.abs(point.y),Math.abs(point.z))>1.001)outside++;
        }
      }
      return {count,outside};
    });
    if(coverage)assert.equal(coverage.outside,0,label+': all case surfaces retain shadow coverage '+JSON.stringify(coverage));
  }
  const visiblePoint=kind=>page.evaluate(async kind=>{
    const THREE=await import('/src/vendor/three/three.module.js'),ray=new THREE.Raycaster();debug.scene.updateMatrixWorld(true);
    const visible=mesh=>{for(let node=mesh;node;node=node.parent)if(!node.visible)return false;return true;};
    const box=debug.meshes.filter(visible),manual=debug.discInteraction.manualObject.children[0].children.filter(visible),disc=debug.discInteraction.object.children[0].children.filter(visible);
    const targets=new Set(kind==='box'?box:manual),r=document.querySelector('#stage canvas').getBoundingClientRect();
    for(let y=.1;y<.85;y+=.035)for(let x=.04;x<.96;x+=.035){
      ray.setFromCamera(new THREE.Vector2(x*2-1,1-y*2),debug.camera);
      const hit=ray.intersectObjects([...box,...manual,...disc],false)[0];
      if(hit&&targets.has(hit.object))return {x:r.left+x*r.width,y:r.top+y*r.height};
    }
    throw Error('No visible '+kind+' surface');
  },kind);
  for(const platform of ['Sony PlayStation 2','Sony PlayStation','Sega Dreamcast','Sony PlayStation 3','Sony PSP','Nintendo DS','Sega Genesis']){
    await t.test(platform,async()=>{
      await page.goto('http://127.0.0.1:'+server.address().port+'/tests/fixtures/three-disc.html?manual=1&platform='+encodeURIComponent(platform));
      await page.waitForFunction(()=>window.viewer?.hasManual&&window.debug?.renderer.info.render.calls>0);
      await page.evaluate(async()=>{viewer.setOpen(true,false);await settle();});
      const manualPoint=await page.evaluate(async()=>{
        const THREE=await import('/src/vendor/three/three.module.js');debug.scene.updateMatrixWorld(true);
        const surfaces=debug.manualMeshes||debug.meshes.filter(mesh=>[debug.materials.cover,debug.materials.manualBack].includes(mesh.material));
        const bounds=new THREE.Box3();for(const mesh of surfaces)bounds.expandByObject(mesh);
        const p=bounds.getCenter(new THREE.Vector3()).project(debug.camera),r=document.querySelector('#stage canvas').getBoundingClientRect();
        return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
      });
      await page.mouse.click(manualPoint.x,manualPoint.y);
      await page.waitForFunction(()=>viewer.isManualRemoved);
      await ready();
      await shadowCoverage(platform+' with manual in foreground');
      assert.equal(await page.evaluate(()=>viewer.isManualRemoved&&debug.discInteraction.manualObject.visible),true);
      assert.equal(await page.evaluate(()=>reads),0,'extraction does not request the reader');
      assert.equal(await page.locator('dialog').count(),0);
      assert.equal(await page.locator('#stage canvas').count(),1,'inspection reuses the case renderer');
      assert.equal(await page.locator('#stage').getAttribute('data-disc-focus'),'manual');
      assert.equal(await page.locator('.game-box-disc-tools [data-disc-focus]').count(),0,'the toolbar has no focus selector buttons');
      assert.equal(await page.locator('.game-box-disc-tools').getByRole('button',{name:'manual.read',exact:true}).count(),0,'the toolbar does not duplicate the existing manual reader action');
      assert.equal(await page.locator('[data-disc-return]:visible').getAttribute('data-disc-return'),'manual');
      if(platform==='Sony PlayStation 2'||platform==='Sega Dreamcast')await page.screenshot({path:'target/manual-extracted-'+(platform==='Sony PlayStation 2'?'ps2':'dreamcast')+'.png'});
      const dragPoint=await visiblePoint('manual'),dragRotation=await page.evaluate(()=>debug.discInteraction.manualObject.quaternion.toArray());
      await page.mouse.move(dragPoint.x,dragPoint.y);await page.mouse.down();await page.mouse.move(dragPoint.x+24,dragPoint.y+12,{steps:12});await page.mouse.up();await ready();
      assert.equal(await page.evaluate(()=>reads),0,'small consecutive drag movements rotate the booklet without opening it');
      assert.notDeepEqual(await page.evaluate(()=>debug.discInteraction.manualObject.quaternion.toArray()),dragRotation);
      const readPoint=await visiblePoint('manual');await page.mouse.click(readPoint.x,readPoint.y);
      assert.equal(await page.evaluate(()=>reads),1,'one click on an extracted manual opens the reader');
      assert.equal(await page.evaluate(()=>debug.discInteraction.manualObject.visible),false);
      await page.evaluate(()=>viewer.returnManual());await ready();
      assert.equal(await page.evaluate(()=>viewer.isManualRemoved&&debug.discInteraction.manualObject.visible),true,'closing the reader preserves the extracted manual');
      const boxRotation=await page.evaluate(()=>debug.root.quaternion.toArray());
      const before=await page.evaluate(()=>debug.discInteraction.manualObject.quaternion.toArray());
      await page.evaluate(async()=>{viewer.rotate(30,20);viewer.zoom(.2);await settle();});
      assert.notDeepEqual(await page.evaluate(()=>debug.discInteraction.manualObject.quaternion.toArray()),before);
      assert.deepEqual(await page.evaluate(()=>debug.root.quaternion.toArray()),boxRotation);
      await page.evaluate(async()=>{viewer.toggleSide();await settle();});
      assert.equal(await page.locator('#stage').getAttribute('data-disc-focus'),'manual','front/back acts on the booklet');
      const boxPoint=await visiblePoint('box');await page.mouse.click(boxPoint.x,boxPoint.y);await ready();
      assert.equal(await page.locator('#stage').getAttribute('data-disc-focus'),'box','clicking the background case brings it forward');
      assert.equal(await page.locator('[data-disc-return]:visible').count(),0,'case focus hides return buttons');
      assert.equal(await page.evaluate(()=>debug.root.position.z>debug.discInteraction.manualObject.position.z),true);
      const bookletPoint=await visiblePoint('manual');await page.mouse.click(bookletPoint.x,bookletPoint.y);await ready();
      assert.equal(await page.evaluate(()=>reads),2,'clicking a visible background booklet also opens its reader');
      await page.evaluate(()=>viewer.returnManual());await ready();
      assert.equal(await page.locator('#stage').getAttribute('data-disc-focus'),'manual','closing the reader brings the background booklet forward');
      if(await page.evaluate(()=>viewer.hasDisc)){
        await page.evaluate(()=>viewer.removeDisc());await ready();
        await shadowCoverage(platform+' with disc in foreground');
        assert.equal(await page.evaluate(()=>viewer.isDiscRemoved&&viewer.isManualRemoved),true,'disc and manual can be outside together');
        assert.equal(await page.locator('[data-disc-return]:visible').getAttribute('data-disc-return'),'disc');
        const discRotation=await page.evaluate(()=>debug.discInteraction.object.quaternion.toArray());
        await page.locator('#stage').click({button:'right',position:{x:50,y:50}});
        await page.getByRole('menuitem',{name:'manual.examine',exact:true}).click();await ready();
        assert.equal(await page.locator('[data-disc-return]:visible').getAttribute('data-disc-return'),'manual');
        await page.evaluate(async()=>{viewer.rotate(-30,10);await settle();});
        assert.deepEqual(await page.evaluate(()=>debug.discInteraction.object.quaternion.toArray()),discRotation,'manual rotation does not rotate the disc');
      }
      await page.locator('#stage').click({button:'right',position:{x:50,y:50}});
      await page.getByRole('menuitem',{name:'box.examine',exact:true}).click();await ready();
      assert.equal(await page.locator('#stage').getAttribute('data-disc-focus'),'box','Examine box selects the case from the context menu');
      await page.locator('#stage').click({button:'right',position:{x:50,y:50}});
      await page.getByRole('menuitem',{name:'manual.read',exact:true}).click();
      assert.equal(await page.evaluate(()=>reads),3,'the context menu still offers the reader directly');
      assert.equal(await page.evaluate(()=>debug.discInteraction.manualObject.visible),false);
      await page.evaluate(()=>viewer.returnManual());
      assert.equal(await page.evaluate(()=>viewer.isManualRemoved&&debug.discInteraction.manualObject.visible),true,'closing the reader returns to inspecting the extracted manual');
      assert.equal(await page.locator('#stage').getAttribute('data-disc-focus'),'manual','closing the reader restores manual focus');
      await page.evaluate(()=>viewer.putManualBack());
      await page.waitForFunction(()=>!viewer.isManualRemoved);
      if(await page.evaluate(()=>viewer.isDiscRemoved)){
        assert.equal(await page.evaluate(()=>debug.discInteraction.object.visible),true,'reinserting the manual leaves the disc outside');
        await page.evaluate(()=>viewer.returnDisc());await page.waitForFunction(()=>!viewer.isDiscRemoved);
      }
      await page.evaluate(async()=>{viewer.setOpen(false,false);viewer.zoom(1);await settle();});
      assert.equal(await page.evaluate(()=>debug.renderer.getContext().getError()),0);
      await page.evaluate(()=>{viewer.setOpen(true,false);viewer.removeManual();select(2);});
      assert.equal(await page.evaluate(()=>debug.discInteraction.manualObject.visible),false,'changing games discards the extracted booklet');
      await page.evaluate(()=>viewer.dispose());
      assert.equal(await page.locator('#stage canvas').count(),0);
    });
  }
  assert.deepEqual(errors,[]);
});
