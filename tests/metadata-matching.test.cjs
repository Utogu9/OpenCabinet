const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function metadataResultLabel('), source.indexOf('function setupGameImageDownloader(')), context);

test('Repository results show distinct serials and prefer the shortest exact serial', () => {
  const base = { id: 1, title: 'Budokai 3 (USA)', platform: 'Sony - PlayStation 2', exact: true, source_key: 'SLUS-20998' };
  const variant = { ...base, id: 2, source_key: 'SLUS-20998GH' };
  assert.equal(context.preferredMetadataMatch([variant, base]), 1);
  assert.equal(context.preferredMetadataMatch([base, variant]), 1);
  assert.match(context.metadataResultLabel(base), /SLUS-20998$/);
  assert.match(context.metadataResultLabel(variant), /SLUS-20998GH$/);
});

test('No automatic tie break for approximate results, different editions or personal catalogs', () => {
  const base = { id: 1, title: 'Game (USA)', platform: 'PS2', exact: true, source_key: 'SLUS-123' };
  assert.equal(context.preferredMetadataMatch([{ ...base, exact: false }]), null);
  assert.equal(context.preferredMetadataMatch([base, { ...base, id: 2, title: 'Game (Europe)' }]), null);
  assert.equal(context.preferredMetadataMatch([base, { ...base, id: 2, title: 'Game (USA) (Rev 1)' }]), null);
  assert.equal(context.preferredMetadataMatch([base, { ...base, id: 2, platform: 'PS3' }]), null);
  const personal = { id: 4, title: 'Game', platform: 'PS2', exact: true };
  assert.equal(context.preferredMetadataMatch([personal]), 4);
  assert.equal(context.preferredMetadataMatch([personal, { ...personal, id: 5 }]), null);
  assert.equal(context.metadataResultLabel(personal), 'Game · PS2');
});

test('Matches display explicit release regions independently of the title in both languages',()=>{
  const game={title:'Switch Example',platform:'Nintendo - Switch',source_key:'AAAAA',regions:['World']};
  for(const [locale,world,japan] of [['es-AR','Mundial','Japón'],['en-US','Worldwide','Japan']]){
    const messages=JSON.parse(fs.readFileSync(path.join(__dirname,`../src/locales/${locale}.json`),'utf8')).messages;
    context.OpenCabinetI18n={t:key=>messages[key]||key};
    assert.equal(context.metadataResultLabel(game),`Switch Example · Nintendo - Switch · ${world} · AAAAA`);
    assert.equal(context.metadataResultLabel({...game,regions:['Europe','Japan']}),`Switch Example · Nintendo - Switch · ${messages['metadata.region.europe']} / ${japan} · AAAAA`);
    assert.equal(context.metadataResultLabel({...game,regions:[]}),`Switch Example · Nintendo - Switch · AAAAA`);
    assert.equal(context.metadataResultLabel({...game,regions:['PAL']}),`Switch Example · Nintendo - Switch · PAL · AAAAA`);
  }
});
