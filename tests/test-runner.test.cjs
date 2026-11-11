const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {discoverTests,partitionTests,runTests}=require('../scripts/test.cjs');

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'opencabinet-test-runner-'));
  t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('opencabinet-test-runner-'));fs.rmSync(root,{recursive:true,force:true});});
  for(const [file,source] of [['tests/unit.test.cjs','unit'],['tests/nested/render.test.cjs',"require('playwright"+"-core')"],['tests/fixtures/example.js','fixture'],['target/copied.test.cjs','temporary copy']]) {
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),source);
  }
  return root;
}
test('Test discovery is limited to the actual tests directory and separates browser suites',t=>{
  const root=fixture(t),files=discoverTests(root);
  assert.deepEqual(files,[path.join('tests','nested','render.test.cjs'),path.join('tests','unit.test.cjs')]);
  const groups=partitionTests(root,files);assert.deepEqual(groups,{unit:[path.join('tests','unit.test.cjs')],browser:[path.join('tests','nested','render.test.cjs')]});
});
test('Unit tests finish before browser tests, whose file concurrency is always one',t=>{
  const calls=[],root=fixture(t);
  assert.equal(runTests({root,spawn:(exe,args,options)=>{calls.push({exe,args,options});return {status:0};}}),0);
  assert.equal(calls.length,2);assert.equal(calls[0].exe,process.execPath);
  assert.ok(!calls[0].args.includes('--test-concurrency=1'));assert.ok(calls[1].args.includes('--test-concurrency=1'));
  assert.equal(calls[0].options.cwd,root);assert.equal(calls[1].options.stdio,'inherit');
});
test('A failing suite propagates its exit code and prevents a false successful release',t=>{
  let calls=0;const root=fixture(t);
  assert.equal(runTests({root,spawn:()=>{calls++;return {status:2};}}),2);assert.equal(calls,1);
  assert.equal(runTests({root,spawn:()=>({status:null,signal:'SIGTERM'})}),1);
});

test('Release unit suites omit browser files while full graphics remain explicitly selectable',t=>{
  const root=fixture(t);
  for(const suite of ['unit','browser']){
    const calls=[];
    assert.equal(runTests({root,suite,args:['--test-reporter=spec'],spawn:(exe,args)=>{calls.push(args);return {status:0};}}),0);
    assert.equal(calls.length,1);assert.ok(calls[0].includes('--test-reporter=spec'));
    assert.equal(calls[0].includes(path.join('tests','unit.test.cjs')),suite==='unit');
    assert.equal(calls[0].includes(path.join('tests','nested','render.test.cjs')),suite==='browser');
  }
  assert.equal(runTests({root,suite:'missing',spawn:()=>{throw Error('must not spawn')}}),1);
});
