const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');

test('All bundled GLBs contain standalone geometry, physical dimensions and baked opening rigs',async()=>{
  const {preparedModels,readModel}=await import('../scripts/model-assets.mjs');
  for(const model of preparedModels) {
    const {manifest,json}=readModel(path.join(root,'src/models',model,'case.glb'),model);
    assert.equal(manifest.sourceUnits,'millimeters',model);
    assert.equal(json.buffers.length,1,model);assert.ok(!json.buffers[0].uri,model);
    const node=json.nodes.find(node=>node.extras?.opencabinetModel);
    assert.deepEqual(node.scale,[.001,.001,.001],model+' uses glTF metres');
    if(model==='cardboard'){assert.deepEqual(manifest.dimensions,[1,1,1]);assert.ok(!json.animations?.length);}
    else assert.ok(json.animations.some(animation=>animation.name==='Open Case'));
    if(!['cardboard','dreamcast'].includes(model)){
      assert.ok(manifest.sourceFaceCount>100,model);
      for(const part of ['lid','spine','tray'])assert.ok(json.nodes.some(node=>node.extras?.casePart===part),model+' '+part);
      assert.ok(json.nodes.some(node=>node.extras?.caseMaterial==='Cover Outside'),model);
    }
  }
});

test('Prepared viewers do not import the legacy compiler or capture temporary construction DOM',()=>{
  const files=['ps2','ps3','ps4','xbox','psp','converted','cardboard'].map(model=>`three-${model}-viewer.js`);
  files.push('three-prepared-case.js','three-prepared-model.js');
  for(const file of files) {
    const source=fs.readFileSync(path.join(root,'src',file),'utf8');
    assert.doesNotMatch(source,/convertLegacyCase|geometrySource\(|faceGeometry\(|getComputedStyle\(/,file);
  }
  assert.match(fs.readFileSync(path.join(root,'src/three-legacy-geometry.js'),'utf8'),/export function convertLegacyCase/,'the authoring code is preserved');
  assert.match(fs.readFileSync(path.join(root,'scripts/export-models.mjs'),'utf8'),/convertLegacyCase/,'conversion remains an explicit development step');
});
