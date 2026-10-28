const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const assets=['case.json','case.bin','insert.webp','insert2.webp','ribs-height.svg','LICENSE-CC0.txt'];
function distribution(t) {
  const target=path.join(root,'target');fs.mkdirSync(target,{recursive:true});
  const projectRoot=fs.mkdtempSync(path.join(target,'three-preparation-'));
  t.after(()=>{
    const resolved=fs.realpathSync(projectRoot),allowed=fs.realpathSync(target)+path.sep;
    assert.ok(resolved.startsWith(allowed),'remove only the test workspace created under target');
    fs.rmSync(resolved,{recursive:true,force:true});
  });
  const model=path.join(projectRoot,'src/models/dreamcast'),textures=path.join(projectRoot,'src/assets/textures');
  fs.mkdirSync(model,{recursive:true});fs.mkdirSync(textures,{recursive:true});
  for(const file of assets)fs.copyFileSync(path.join(root,'src/models/dreamcast',file),path.join(model,file));
  fs.copyFileSync(path.join(root,'src/assets/textures/cd-case-ribs.svg'),path.join(textures,'cd-case-ribs.svg'));
  const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(model,file))).digest('hex');
  return {projectRoot,model,digest,options:{projectRoot,dependencyRoot:path.join(root,'node_modules/three')}};
}

test('A fresh distribution prepares Three.js without authoring files and preserves bundled model assets',async t=>{
  const {prepare}=await import('../scripts/prepare-three.mjs'),app=distribution(t);
  const original=assets.map(app.digest);prepare(app.options);
  assert.deepEqual(assets.map(app.digest),original);
  assert.equal(fs.existsSync(path.join(app.projectRoot,'_modelos')),false);
  assert.equal(fs.existsSync(path.join(app.model,'.source-hash')),false);
  assert.match(fs.readFileSync(path.join(app.projectRoot,'src/local-models.js'),'utf8'),/"switch":false/);
  const vendor=path.join(app.projectRoot,'src/vendor/three');
  assert.ok(fs.statSync(path.join(vendor,'three.module.js')).size>0);
  assert.match(fs.readFileSync(path.join(vendor,'RoomEnvironment.js'),'utf8'),/from '\.\/three\.module\.js'/);
  assert.equal(fs.readFileSync(path.join(vendor,'LICENSE'),'utf8'),fs.readFileSync(path.join(root,'node_modules/three/LICENSE'),'utf8'));
  // Leaving an empty source folder after archiving the OBJ files is also valid.
  fs.mkdirSync(path.join(app.projectRoot,'_modelos/Dreamcast'),{recursive:true});prepare(app.options);
  assert.deepEqual(assets.map(app.digest),original);
});

test('Preparing a distribution rejects missing runtime images and truncated geometry',async t=>{
  const {prepare}=await import('../scripts/prepare-three.mjs'),app=distribution(t);
  fs.writeFileSync(path.join(app.model,'case.bin'),Buffer.alloc(4));
  assert.throws(()=>prepare(app.options),/geometry is incomplete/);
  fs.copyFileSync(path.join(root,'src/models/dreamcast/case.bin'),path.join(app.model,'case.bin'));
  fs.unlinkSync(path.join(app.model,'insert2.webp'));
  assert.throws(()=>prepare(app.options),/Missing bundled Dreamcast assets: insert2.webp/);
});
