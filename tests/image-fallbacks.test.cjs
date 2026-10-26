const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('./helpers/localized-vm.cjs'),path=require('node:path');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/image-fallbacks.js'),'utf8'),context);
const resolve=context.OpenCabinetImages.resolve;
test('Full-cover UV regions share exact boundaries on one horizontal or vertical atlas',()=>{
  const horizontal=context.OpenCabinetImages.wrapRegions({width:135,height:190,depth:14});
  assert.equal(horizontal.back_cover.position,'0% 0%');
  assert.equal(horizontal.cover.position,'100% 0%');
  assert.equal(horizontal.spine.position,'50% 0%');
  assert.ok(Math.abs(parseFloat(horizontal.cover.size)-284/135*100)<1e-9);
  assert.ok(Math.abs(parseFloat(horizontal.spine.size)-284/14*100)<1e-9);
  const vertical=context.OpenCabinetImages.wrapRegions({width:135,height:190,depth:14},'y');
  assert.equal(vertical.back_cover.position,'0% 0%');assert.equal(vertical.cover.position,'0% 100%');
  assert.equal(vertical.spine.position,'0% 50%');assert.ok(vertical.cover.size.startsWith('100% '));
});
test('Fanart supplies missing front, back, cartridge and disc textures without changing stored types',()=>{
  for(const [normal,fanart] of Object.entries({cover:'fanart_cover',back_cover:'fanart_back_cover',cart_front:'fanart_cart_front',cart_back:'fanart_cart_back',disc:'fanart_disc'})){
    const images=[{kind:fanart,path:'first.png'},{kind:fanart,path:'second.png'}];
    const result=resolve(images);
    assert.equal(result.find(image=>image.kind===normal).path,'first.png');
    assert.equal(result[0].source_kind,fanart);
    assert.equal(result[1].kind,fanart);
    assert.ok(images.every(image=>image.kind===fanart));
    assert.equal(resolve(result).filter(image=>image.kind===normal).length,1);
  }
});
test('Normal images always take priority regardless of position; no equivalent means no fabricated texture',()=>{
  const result=resolve([{kind:'fanart_cover',path:'fanart.png'},{kind:'cover',path:'real.png'},{kind:'fanart_background',path:'background.png'}]);
  assert.equal(result.find(image=>image.kind==='cover').path,'real.png');
  assert.equal(result[0].kind,'fanart_cover');
  assert.equal(result.some(image=>image.kind==='back_cover'||image.kind==='spine'),false);
  assert.equal(resolve([{kind:'cover',path:''},{kind:'fanart_cover',path:'fallback.png'}]).find(image=>image.kind==='cover'&&image.path).path,'fallback.png');
});
