// Keep software-rendered browser tests from competing for GPU/CPU resources.
// Explicit discovery also avoids running temporary copies inside target/.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');

function discoverTests(root) {
  const files=[];
  function walk(directory) {
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())walk(file);
      else if(entry.isFile()&&/\.(?:test|spec)\.(?:cjs|mjs|js)$/.test(entry.name))files.push(path.relative(root,file));
    }
  }
  walk(path.join(root,'tests'));return files.sort();
}
function partitionTests(root,files) {
  const unit=[],browser=[];
  for(const file of files) {
    const source=fs.readFileSync(path.join(root,file),'utf8');
    (/playwright-core/.test(source)?browser:unit).push(file);
  }
  return {unit,browser};
}
function runTests({root=path.resolve(__dirname,'..'),spawn=spawnSync,args=[]}={}) {
  const groups=partitionTests(root,discoverTests(root));
  for(const [name,files] of Object.entries(groups)) {
    if(!files.length)continue;
    console.log(`Running ${name} test files: ${files.length}${name==='browser'?' (one browser suite at a time)':''}`);
    const result=spawn(process.execPath,['--test',...args,...(name==='browser'?['--test-concurrency=1']:[]),...files],{cwd:root,stdio:'inherit'});
    if(result.error){console.error(result.error.message);return 1;}
    if(result.status!==0)return result.status||1;
  }
  return 0;
}
if(require.main===module)process.exitCode=runTests({args:process.argv.slice(2)});
module.exports={discoverTests,partitionTests,runTests};
