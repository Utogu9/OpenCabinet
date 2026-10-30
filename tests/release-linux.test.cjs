const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {stageLinux,combine}=require('../scripts/release-artifacts.cjs');
function fixture(t){
  const parent=path.resolve('target/linux-release-tests');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'build-'));
  t.after(()=>{assert.equal(path.dirname(root),parent);fs.rmSync(root,{recursive:true,force:true});});
  const write=(name,data)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof data==='object'&&!Buffer.isBuffer(data)?JSON.stringify(data):data);};
  const version='0.2.0',tag='v'+version,repository='Utogu9/OpenCabinet';
  write('package.json',{version});write('package-lock.json',{version,packages:{'':{version}}});write('src-tauri/Cargo.toml',`[package]\nname="opencabinet"\nversion="${version}"\n`);write('src-tauri/Cargo.lock',`[[package]]\nname="opencabinet"\nversion="${version}"\n`);
  write('src-tauri/tauri.conf.json',{version,bundle:{createUpdaterArtifacts:true},plugins:{updater:{pubkey:'fixture',endpoints:[`https://github.com/${repository}/releases/latest/download/latest.json`]}}});write('.github/release-notes.md','Release notes');
  const signature=Buffer.from(`trusted comment: file:test\tversion:${version}`).toString('base64'),bundle='src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage';
  write(bundle+'/OpenCabinet.AppImage',Buffer.from([0x7f,0x45,0x4c,0x46,1]));write(bundle+'/OpenCabinet.AppImage.sig',signature);write(bundle+'/data/private.db','private');
  return {root,write,signature,bundle,tag,version,repository};
}
test('Linux stages only the signed AppImage and never local data',t=>{
  const f=fixture(t),output=stageLinux(f.root,f.tag);assert.deepEqual(fs.readdirSync(output).sort(),[`OpenCabinet_${f.tag}_linux_x86_64.AppImage`,`OpenCabinet_${f.tag}_linux_x86_64.AppImage.sig`,'linux.json']);
  const feed=JSON.parse(fs.readFileSync(path.join(output,'linux.json')));assert.equal(feed.platforms['linux-x86_64'].signature,f.signature);assert.throws(()=>stageLinux(f.root,f.tag),/not empty/);
});
test('Missing signatures and non-ELF builds cannot be published',t=>{
  const f=fixture(t);f.write(f.bundle+'/OpenCabinet.AppImage.sig',Buffer.from('trusted comment: version:0.0.1').toString('base64'));assert.throws(()=>stageLinux(f.root,f.tag),/version/);assert.equal(fs.existsSync(path.join(f.root,'target/release-assets')),false);
  f.write(f.bundle+'/OpenCabinet.AppImage.sig',f.signature);f.write(f.bundle+'/OpenCabinet.AppImage','MZWindows');assert.throws(()=>stageLinux(f.root,f.tag),/ELF/);
});
test('Publication waits for both platforms and combines their update targets and checksums',t=>{
  const f=fixture(t);assert.throws(()=>combine(f.root,f.tag));const linux=stageLinux(f.root,f.tag);
  fs.mkdirSync(path.join(f.root,'target/release-download'),{recursive:true});fs.renameSync(linux,path.join(f.root,'target/release-download/linux'));
  const name=`OpenCabinet_${f.tag}_windows_x64_setup.exe`,windows='target/release-download/windows/';
  f.write(windows+name,'MZsetup');f.write(windows+name+'.sig',f.signature);f.write(windows+`OpenCabinet_${f.tag}_windows_x64_portable.zip`,'ZIP');
  f.write(windows+'windows.json',{version:f.version,platforms:{'windows-x86_64':{signature:f.signature,url:`https://github.com/${f.repository}/releases/download/${f.tag}/${name}`}}});
  const output=combine(f.root,f.tag),feed=JSON.parse(fs.readFileSync(path.join(output,'latest.json')));assert.deepEqual(Object.keys(feed.platforms).sort(),['linux-x86_64','windows-x86_64']);assert.equal(fs.readFileSync(path.join(output,'SHA256SUMS.txt'),'utf8').trim().split('\n').length,6);assert.equal(fs.existsSync(path.join(output,'data')),false);
});
