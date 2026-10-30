// Runs against Tauri/WebKitGTK, not a Chromium imitation. Uses a disposable Linux profile.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
function manualPdf(){
  const stream='0.2 0.4 0.7 rg 0 0 200 300 re f\n';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << >> /Contents 4 0 R >>',`<< /Length ${stream.length} >>\nstream\n${stream}endstream`];
  let text='%PDF-1.4\n';const offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(text));text+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(text);text+=`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return 'data:application/pdf;base64,'+Buffer.from(text).toString('base64');
}
function manualCbz(file){
  const bytes=fs.readFileSync('src-tauri/icons/128x128.png'),name=Buffer.from('001.png'),crc=require('node:zlib').crc32(bytes);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+bytes.length,16);
  fs.writeFileSync(file,Buffer.concat([local,name,bytes,central,name,end]));
}
async function main(){
  if(process.platform!=='linux')throw Error('Run this smoke test on Linux under X11/Xvfb.');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'opencabinet-webkit-'));
  const working=path.join(root,'Working directory');fs.mkdirSync(working);
  const nativeGame=path.join(root,'Native game ñ 日本.sh');
  const launchedFrom=path.join(root,'launched-from.txt'),quotedOutput="'"+launchedFrom.replaceAll("'","'\\''")+"'";
  fs.writeFileSync(nativeGame,'#!/bin/sh\nprintf \'%s\' "$PWD" > '+quotedOutput+'\nsleep 2\n',{mode:0o755});
  const cbz=path.join(root,'Manual.cbz');manualCbz(cbz);
  const fakeBin=path.join(root,'fake-bin'),openLog=path.join(root,'desktop-open.txt');fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin,'xdg-open'),'#!/bin/sh\nprintf \'%s|%s|%s\\n\' "$1" "${APPDIR:-}" "${LD_LIBRARY_PATH:-}" >> "$OPENCABINET_OPEN_LOG"\n',{mode:0o755});
  const driver=spawn(path.join(os.homedir(),'.cargo/bin/tauri-driver'),[],{stdio:'inherit',env:{...process.env,PATH:fakeBin+path.delimiter+process.env.PATH,OPENCABINET_OPEN_LOG:openLog,GDK_BACKEND:'x11',WAYLAND_DISPLAY:'',XDG_CONFIG_HOME:path.join(root,'config'),XDG_DATA_HOME:path.join(root,'data'),XDG_CACHE_HOME:path.join(root,'cache')}});
  let spawnError;driver.on('error',error=>{spawnError=error;});let session;
  async function request(method,url,body){
    const response=await fetch('http://127.0.0.1:4444'+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
    const result=await response.json();if(!response.ok||result.value?.error)throw Error(JSON.stringify(result));return result.value;
  }
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  try{
    for(let n=0;n<80;n++){if(spawnError)throw spawnError;try{await request('GET','/status');break;}catch(error){if(n===79)throw error;await sleep(250);}}
    const value=await request('POST','/session',{capabilities:{alwaysMatch:{browserName:'wry','tauri:options':{application:path.resolve(process.argv[2])}}}});session=value.sessionId;
    assert.ok(session);
    await request('POST',`/session/${session}/timeouts`,{script:60000});
    const script=async source=>request('POST',`/session/${session}/execute/async`,{script:`const done=arguments[arguments.length-1];(async()=>{${source}})().then(value=>done({value}),error=>done({error:String(error)}));`,args:[]});
    const result=await script(`
      for(let n=0;n<200&&document.documentElement.dataset.os!=='linux';n++)await new Promise(r=>setTimeout(r,50));
      const invoke=window.__TAURI__.core.invoke;
      const capabilities=await invoke('get_runtime_capabilities');
      const location=await invoke('get_data_location');
      const games=await invoke('get_games');
      return {capabilities,location,count:games.length,os:document.documentElement.dataset.os,epicHidden:document.getElementById('btn-import-epic').classList.contains('hidden'),css3d:CSS.supports('transform-style','preserve-3d'),title:document.title};
    `);
    if(result.error)throw Error(result.error);const state=result.value;
    assert.equal(state.capabilities.os,'linux');assert.equal(state.os,'linux');assert.equal(state.count,0);assert.equal(state.epicHidden,true);assert.equal(state.css3d,true);assert.equal(state.title,'OpenCabinet');
    assert.ok(state.location.active_directory.startsWith(path.join(root,'data')));assert.ok(state.location.config_file.startsWith(path.join(root,'config')));
    const theme=await script(`document.getElementById('btn-open-preferences').click();return {open:document.getElementById('preferences-dialog').open};`);
    if(theme.error)throw Error(theme.error);assert.equal(theme.value.open,true);
    const fullscreen=await script(`
      const appWindow=window.__TAURI__.window.getCurrentWindow();
      await appWindow.setFullscreen(true);const entered=await appWindow.isFullscreen();
      await appWindow.setFullscreen(false);return {entered,exited:!await appWindow.isFullscreen()};
    `);
    if(fullscreen.error)throw Error(fullscreen.error);assert.equal(fullscreen.value.entered,true);assert.equal(fullscreen.value.exited,true);
    const screenshot=await request('GET',`/session/${session}/screenshot`);fs.mkdirSync('target',{recursive:true});fs.writeFileSync('target/linux-webkit-smoke.png',Buffer.from(screenshot,'base64'));
    const boxes=await script(`
      document.getElementById('preferences-dialog').close();
      const art=document.createElement('canvas');art.width=480;art.height=480;const paint=art.getContext('2d');paint.fillStyle='#7644bb';paint.fillRect(0,0,480,480);paint.fillStyle='#ffee55';paint.fillRect(30,30,160,420);const picture=art.toDataURL();
      const images=['cover','back_cover','spine','disc','inlay'].map(kind=>({kind,path:picture}));
      const results=[];
      for(const platform of ['Sony PlayStation 2','Sega Dreamcast']){
        const host=document.createElement('div');host.className='game-box-stage';host.style.cssText='position:fixed;top:30px;left:30px;width:600px;height:500px;z-index:99999';document.body.append(host);
        const viewer=window.OpenCabinet3D.createViewer(host,{imageSource:path=>path});
        viewer.update({id:999,title:'Linux render fixture',platform,rom_path:'/test/game.chd'},images);
        for(let n=0;n<200&&!host.children.length;n++)await new Promise(resolve=>setTimeout(resolve,50));
        await new Promise(resolve=>setTimeout(resolve,1000));
        viewer.setOpen(true,false);viewer.zoom(.1);viewer.setRotationLock('y');
        await new Promise(resolve=>setTimeout(resolve,300));
        results.push({platform,renderer:host.dataset.renderer||'css',children:host.children.length,canOpen:viewer.canOpen,open:viewer.isOpen});
        viewer.dispose();host.remove();
      }
      return results;
    `);
    if(boxes.error)throw Error(boxes.error);
    for(const box of boxes.value){assert.ok(box.children>0);assert.equal(box.canOpen,true);assert.equal(box.open,true);}
    assert.equal(boxes.value[0].renderer,'css');
    const played=await script(`
      const invoke=window.__TAURI__.core.invoke,progress=new window.__TAURI__.core.Channel();progress.onmessage=()=>{};
      const preview=await invoke('preview_single_game',{platform:'PC',filePath:${JSON.stringify(nativeGame)},title:'Native Linux fixture',launchDirectly:true});
      preview.games[0].linux_execution={mode:'native',working_directory:${JSON.stringify(working)}};
      const imported=await invoke('import_scanned_roms',{preview,platform:'PC',jobId:null,mediaSelections:[],onProgress:progress});
      const game=(await invoke('get_games')).find(game=>game.title==='Native Linux fixture');
      await invoke('launch_game',{gameId:game.id,discId:null,regionId:null});
      for(let n=0;n<100;n++){
        await new Promise(resolve=>setTimeout(resolve,100));
        const played=(await invoke('get_games')).find(candidate=>candidate.id===game.id);
        if(!played.is_running)return {imported:imported.added_count,sessions:played.session_count,seconds:played.play_time_seconds,working:played.execution.linux.working_directory};
      }
      throw Error('The native session did not finish');
    `);
    if(played.error)throw Error(played.error);assert.equal(played.value.imported,1);assert.equal(played.value.sessions,1);assert.ok(played.value.seconds>=1);assert.equal(played.value.working,working);
    assert.equal(fs.readFileSync(launchedFrom,'utf8'),working);
    const manuals=await script(`
      const results=[];
      for(const path of [${JSON.stringify(manualPdf())},${JSON.stringify(cbz)}]){
        const manual=await window.OpenCabinetManualPDF.render(path,{maxSide:128,coverMode:'full',platform:'Sony PlayStation 2'});
        results.push({pages:manual.pageCount,width:manual.front.width,height:manual.front.height});manual.dispose();
      }
      return results;
    `);
    if(manuals.error)throw Error(manuals.error);for(const manual of manuals.value){assert.equal(manual.pages,1);assert.ok(manual.width>0&&manual.height>0);}
    const opened=await script(`await window.__TAURI__.core.invoke('open_project_repository');await window.__TAURI__.core.invoke('open_backup_directory');return true;`);
    if(opened.error)throw Error(opened.error);
    for(let n=0;n<100&&(!fs.existsSync(openLog)||fs.readFileSync(openLog,'utf8').trim().split('\n').length<2);n++)await sleep(50);
    const targets=fs.readFileSync(openLog,'utf8').trim().split('\n').map(line=>line.split('|'));
    assert.equal(targets.length,2);assert.ok(targets.some(([url])=>url==='https://github.com/Utogu9/OpenCabinet'));
    for(const [,appdir,libraries]of targets){assert.equal(appdir,'');assert.doesNotMatch(libraries,/appimage_extracted|\/\.mount_/);}
    console.log('Linux WebKitGTK startup, fullscreen, IPC, XDG storage, desktop opening, Unicode native game/session, PDF/CBZ manuals and 3D boxes passed:',JSON.stringify(boxes.value));
  }finally{
    if(session)await request('DELETE',`/session/${session}`).catch(()=>{});
    driver.kill();await new Promise(resolve=>driver.exitCode!==null?resolve():driver.once('exit',resolve));
    assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
