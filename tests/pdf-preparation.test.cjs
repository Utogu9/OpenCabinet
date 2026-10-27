const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('./helpers/localized-vm.cjs');

test('Development waits for PDF preparation before starting the live-reload server', () => {
  const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
  const preparations=config.build.beforeDevCommand.script.split(' && ');
  assert.ok(preparations.includes('npm run prepare:pdf'));
  assert.ok(preparations.every(command=>command.startsWith('npm run prepare:')));
  assert.equal(config.build.beforeDevCommand.wait, true);
});

test('Preparing PDF.js preserves unchanged files and repairs changed, missing and incomplete assets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'opencabinet-pdf-preparation-'));
  try {
    const source = path.join(root,'pdfjs'), destination = path.join(root,'src/vendor/pdfjs');
    const assets = ['build/pdf.min.mjs','build/pdf.worker.min.mjs','cmaps/japan.bcmap',
      'standard_fonts/font.pfb','wasm/decode.wasm','iccs/nested/color.icc','LICENSE'];
    for (const asset of assets) {
      const file = path.join(source,asset); fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,`original:${asset}`);
    }
    const run = () => {
      const dependencies = name => require(name);
      dependencies.resolve = () => path.join(source,'package.json');
      vm.runInNewContext(fs.readFileSync('scripts/prepare-pdfjs.cjs','utf8'),{
        require:dependencies, __dirname:path.join(root,'scripts'), console:{log(){}},
      });
    };
    const target = asset => path.join(destination,asset.replace(/^build\//,''));
    run();
    // Force old timestamps, so an accidental rewrite is detectable on any FS.
    for (const asset of assets) fs.utimesSync(target(asset),new Date(0),new Date(0));
    run();
    for (const asset of assets) assert.equal(fs.statSync(target(asset)).mtimeMs,0,asset);
    fs.writeFileSync(path.join(source,assets[0]),'updated module');
    fs.writeFileSync(target(assets[2]),'corrupted'.padEnd(`original:${assets[2]}`.length,'!'));
    fs.unlinkSync(target(assets[4]));
    run();
    for (const asset of assets) assert.ok(fs.readFileSync(target(asset)).equals(fs.readFileSync(path.join(source,asset))),asset);
    assert.equal(fs.statSync(target('LICENSE')).mtimeMs,0,'unchanged assets still avoid reload events');
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});
