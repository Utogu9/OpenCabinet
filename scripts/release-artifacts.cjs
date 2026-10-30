// Stage Linux and combine both signed builds. Publication happens only after both succeed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {verifyVersions}=require('./release-windows.cjs');
function configuration(root,tag){
  const {version}=verifyVersions(root,tag),config=JSON.parse(fs.readFileSync(path.join(root,'src-tauri/tauri.conf.json'),'utf8'));
  const repository=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/latest\/download\/latest\.json$/.exec(config.plugins?.updater?.endpoints?.[0]||'')?.[1];
  if(!repository||!config.plugins.updater.pubkey||config.bundle?.createUpdaterArtifacts!==true)throw Error('Configure signed updates first.');
  if(process.env.GITHUB_REPOSITORY&&process.env.GITHUB_REPOSITORY.toLowerCase()!==repository.toLowerCase())throw Error('Update repository mismatch.');
  return {version,repository,notes:fs.readFileSync(path.join(root,'.github/release-notes.md'),'utf8').trim()};
}
function validateSignature(signature,version){
  if(!signature||!/^[A-Za-z0-9+/=\r\n]+$/.test(signature))throw Error('Missing updater signature.');
  const comment=Buffer.from(signature,'base64').toString('utf8').split(/\r?\n/).find(line=>line.startsWith('trusted comment:'))||'';
  if(!comment.split('\t').includes(`version:${version}`))throw Error('Signature is not bound to this release version.');
}
function empty(directory){if(fs.existsSync(directory)&&fs.readdirSync(directory).length)throw Error('Output directory is not empty.');fs.mkdirSync(directory,{recursive:true});}
function stageLinux(root,tag){
  const {version,repository,notes}=configuration(root,tag);
  const bundle=path.join(root,'src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage');
  const images=fs.readdirSync(bundle).filter(name=>name.endsWith('.AppImage'));
  if(images.length!==1)throw Error('Expected exactly one AppImage.');
  const image=path.join(bundle,images[0]),signature=fs.readFileSync(image+'.sig','utf8').trim();validateSignature(signature,version);
  const handle=fs.openSync(image,'r'),header=Buffer.alloc(4);try{fs.readSync(handle,header);}finally{fs.closeSync(handle);}
  if(!header.equals(Buffer.from([0x7f,0x45,0x4c,0x46])))throw Error('Expected an ELF AppImage.');
  const directory=path.join(root,'target/release-assets'),name=`OpenCabinet_${tag}_linux_x86_64.AppImage`;
  empty(directory);fs.copyFileSync(image,path.join(directory,name),fs.constants.COPYFILE_EXCL);fs.copyFileSync(image+'.sig',path.join(directory,name+'.sig'),fs.constants.COPYFILE_EXCL);
  const manifest={version,notes,pub_date:new Date().toISOString(),platforms:{'linux-x86_64':{signature,url:`https://github.com/${repository}/releases/download/${tag}/${name}`}}};
  fs.writeFileSync(path.join(directory,'linux.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return directory;
}
function combine(root,tag){
  const {version,repository,notes}=configuration(root,tag),input=path.join(root,'target/release-download'),output=path.join(root,'target/release-assets');
  const platforms={},copies=[];
  for(const [folder,key,manifestName,names]of [
    ['windows','windows-x86_64','windows.json',[`OpenCabinet_${tag}_windows_x64_setup.exe`,`OpenCabinet_${tag}_windows_x64_setup.exe.sig`,`OpenCabinet_${tag}_windows_x64_portable.zip`]],
    ['linux','linux-x86_64','linux.json',[`OpenCabinet_${tag}_linux_x86_64.AppImage`,`OpenCabinet_${tag}_linux_x86_64.AppImage.sig`]],
  ]){
    const directory=path.join(input,folder),manifest=JSON.parse(fs.readFileSync(path.join(directory,manifestName),'utf8'));
    if(manifest.version!==version||Object.keys(manifest.platforms||{}).join()!==key)throw Error('Incomplete or mismatched platform manifest.');
    const entry=manifest.platforms[key];validateSignature(entry.signature,version);
    if(entry.url!==`https://github.com/${repository}/releases/download/${tag}/${names[0]}`)throw Error('Unexpected update URL.');
    for(const name of names){const source=path.join(directory,name);if(!fs.statSync(source).isFile()||!fs.statSync(source).size)throw Error('Missing release artifact.');copies.push([source,name]);}
    if(fs.readFileSync(path.join(directory,names[0]+'.sig'),'utf8').trim()!==entry.signature)throw Error('Signature mismatch.');
    platforms[key]=entry;
  }
  empty(output);
  for(const [source,name]of copies)fs.copyFileSync(source,path.join(output,name),fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(output,'latest.json'),JSON.stringify({version,notes,pub_date:new Date().toISOString(),platforms},null,2)+'\n',{flag:'wx'});
  const files=fs.readdirSync(output).sort();
  fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),files.map(name=>`${crypto.createHash('sha256').update(fs.readFileSync(path.join(output,name))).digest('hex')}  ${name}\n`).join(''),{flag:'wx'});
  return output;
}
if(require.main===module){try{const tag=process.env.RELEASE_TAG;if(process.argv[2]==='linux')console.log(stageLinux(process.cwd(),tag));else if(process.argv[2]==='combine')console.log(combine(process.cwd(),tag));else throw Error('Use linux or combine.');}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={stageLinux,combine};
