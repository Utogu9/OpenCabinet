const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const vm=require('./helpers/localized-vm.cjs');
function fixture({sizes={},handler,decode}={}){
  const calls=[],bitmaps=[],draws=[],canvases=[];
  const context=vm.createContext({AbortController,DOMException,Blob,Uint8Array,URL,
    __TAURI__:{core:{invoke:async(command,args)=>{
      calls.push({command,args});if(handler){const result=handler(command,args);if(result!==undefined)return result;}
      return command==='get_cbz_manifest'?{fingerprint:'v1',pages:[{index:5},{index:1},{index:2}]}:new Uint8Array([args.index]).buffer;
    }}},
    createImageBitmap:async blob=>{
      const index=new Uint8Array(await blob.arrayBuffer())[0];if(decode)return decode(index);
      const [width,height]=sizes[index]||[400,600],bitmap={width,height,index,closed:0,close(){this.closed++;}};bitmaps.push(bitmap);return bitmap;
    },
    document:{baseURI:'http://app.local/src/index.html',createElement(tag){
      assert.equal(tag,'canvas');const canvas={width:0,height:0,getContext(){return {canvas,save(){},restore(){},fillRect(){},transform(...value){draws.push({transform:value});},drawImage(bitmap,...values){draws.push({index:bitmap.index,values});}};}};canvases.push(canvas);return canvas;
    }},
  });
  vm.runInContext(fs.readFileSync('src/cbz-manual.js','utf8'),context);
  vm.runInContext(fs.readFileSync('src/pdf-manual.js','utf8'),context);
  return {context,calls,bitmaps,draws,canvases,api:context.OpenCabinetManualPDF,library:context.OpenCabinetManualCBZ.library,
    render:options=>context.OpenCabinetManualPDF.render('Manual.CBZ',options),open:options=>context.OpenCabinetManualPDF.open('Manual.CBZ',options)};
}
test('CBZ previews decode only the first sorted page and fetch the back cover only on request',async()=>{
  const app=fixture(),manual=await app.render();assert.equal(manual.pageCount,3);assert.equal(manual.aspectRatio,2/3);
  assert.deepEqual(app.calls.map(call=>call.command),['get_cbz_manifest','read_cbz_page']);assert.equal(app.calls[1].args.index,5);
  assert.equal(app.bitmaps[0].closed,1);assert.ok(manual.front.width>0);
  const back=await manual.loadBack();assert.ok(back.width>0);assert.equal(app.calls.at(-1).args.index,2);
  assert.ok(app.bitmaps.every(bitmap=>bitmap.closed===1));manual.dispose();assert.ok(app.canvases.every(canvas=>canvas.width===0));
  await assert.rejects(manual.loadBack(),error=>error.name==='AbortError');
});
test('CBZ reading keeps numeric archive indexes, renders pages on demand and releases each decoded image',async()=>{
  const app=fixture(),doc=await app.open({layout:'original'});assert.equal(doc.pageCount,3);assert.equal(app.calls.length,1);
  const canvas=await doc.renderPage(2,{maxSide:900});assert.equal(app.calls.at(-1).args.index,1);assert.equal(canvas.height,900);
  assert.equal(app.bitmaps[0].closed,1);assert.equal(app.draws[0].index,1);doc.release(canvas);assert.equal(canvas.width,0);
  const another=await doc.renderPage(3);doc.dispose();assert.equal(another.width,0);
  await assert.rejects(doc.renderPage(1),error=>error.name==='AbortError');
});
test('CBZ spread covers use the existing crop and booklet order, including square DS manuals',async()=>{
  const app=fixture({sizes:{5:[2000,1000],1:[2000,1000],2:[2000,1000]}}),manual=await app.render({platform:'Nintendo DS'});
  assert.equal(manual.splitCover,true);assert.equal(manual.aspectRatio,1);assert.ok(app.draws.some(draw=>draw.transform?.[4]<0));
  await manual.loadBack();assert.equal(app.calls.filter(call=>call.command==='read_cbz_page').at(-1).args.index,5);
  const doc=await app.open({platform:manual.platform,layout:'auto'});assert.equal(doc.pageCount,6);assert.equal(doc.layout,'booklet');
  await doc.renderPage(2);assert.equal(app.calls.at(-1).args.index,1);doc.dispose();manual.dispose();
});
test('Destroying a CBZ document rejects late page reads without decoding or retaining their bytes',async()=>{
  let resolve;const app=fixture({handler:command=>command==='read_cbz_page'?new Promise(done=>{resolve=done;}):undefined});
  const task=app.library('Guide.cbz').getDocument(),doc=await task.promise,pending=doc.getPage(1);await task.destroy();resolve(new Uint8Array([5]).buffer);
  await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(app.bitmaps.length,0);
});
test('A late CBZ image decode is closed, cancelled drawing is skipped, and invalid archives are reported',async()=>{
  let finish;const app=fixture({decode:()=>new Promise(resolve=>{finish=resolve;})}),task=app.library('Guide.cbz').getDocument(),doc=await task.promise;
  const pending=doc.getPage(1);while(!finish)await new Promise(resolve=>setImmediate(resolve));await task.destroy();
  const bitmap={width:10,height:20,closed:0,close(){this.closed++;}};finish(bitmap);await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(bitmap.closed,1);
  const normal=fixture(),normalTask=normal.library('Guide.cbz').getDocument(),page=await (await normalTask.promise).getPage(1);
  const drawing=page.render({canvasContext:{},viewport:{width:10,height:20}});drawing.cancel();await assert.rejects(drawing.promise,error=>error.name==='AbortError');await normalTask.destroy();
  const empty=fixture({handler:()=>({pages:[],fingerprint:'v1'})});await assert.rejects(empty.render(),/CBZ/);
  const invalid=fixture({handler:command=>{if(command==='read_cbz_page')throw Error('Bad CRC');}});await assert.rejects(invalid.render(),/Bad CRC/);
});
