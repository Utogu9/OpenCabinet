const {test}=require('node:test'),assert=require('node:assert/strict');
require('../src/poster-settings.js');const api=globalThis.OpenCabinetPosters;
const images=[{kind:'poster_back',path:'images/1/poster_back2.webp'},{kind:'poster_front',path:'images/1/poster_front.webp'},{kind:'poster_front',path:'images/1/poster_front2.webp'},{kind:'poster_back',path:'images/1/poster_back.webp'}];
test('Numbered poster files pair by number, including missing sides and additional unnumbered scans',()=>{
  const items=api.collection(null,images);
  assert.equal(items.length,2);assert.equal(items[0].front,images[1].path);assert.equal(items[0].back,images[3].path);
  assert.equal(items[1].front,images[2].path);assert.equal(items[1].back,images[0].path);
  const missing=api.collection(null,images.slice(0,2));assert.equal(missing.length,2);assert.equal(missing[0].back,null);assert.equal(missing[1].front,null);
  assert.equal(api.collection(null,[{kind:'poster_front',path:'a.webp'},{kind:'poster_front',path:'b.webp'}]).length,2);
});
test('Explicit poster pairing, stack order and individual folds survive portable image paths and box overrides',()=>{
  const folds=api.settings({poster:{columns:3,rows:4,rotation:90}}),pairs=api.collection(null,images);
  pairs[1].name='Map';pairs[1].settings=folds;pairs.reverse();
  const saved=api.withPoster({base:{color:'#123456'}},pairs);
  const relocated=images.map(image=>({...image,path:'/new data/'+image.path}));
  const restored=api.collection(saved,relocated);assert.equal(restored[0].name,'Map');assert.equal(restored[0].front,'/new data/'+images[2].path);assert.equal(restored[0].settings.columns,3);
  assert.equal(saved.base.color,'#123456');assert.equal(api.withoutPoster(saved).posters,undefined);
  assert.deepEqual(api.collection({posters:[]},images),[],'removing a pairing keeps its art without silently restoring the packet');
  assert.equal(api.collection({poster:{columns:5}},images)[0].settings.columns,5,'older single-poster folds remain readable');
  assert.equal(api.collection(saved,relocated.filter(image=>image.kind!=='poster_back'))[0].back,null,'a missing reverse never borrows another scan');
});
