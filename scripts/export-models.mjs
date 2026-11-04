// Explicit authoring step. App startup and release builds only read the GLBs.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const require=createRequire(import.meta.url);
const {chromium}=require('playwright-core');
const cases=[
  ['dvd','PC'],
  ['ps2','Sony PlayStation 2'],['ps3','Sony PlayStation 3'],['ps4','Sony PlayStation 4'],
  ['xbox','Microsoft Xbox'],['psp','Sony PSP'],['genesis','Sega Mega Drive / Genesis'],
  ['wii','Nintendo Wii'],['wiiu','Nintendo Wii U'],['gamecube','Nintendo GameCube'],
  ['gamecube-japan','Nintendo GameCube','Game (Japan).iso'],['ds','Nintendo DS'],
  ['ds-pal','Nintendo DS','Game (Europe).nds'],['3ds','Nintendo 3DS'],['longbox','Sega Saturn'],
  ['cardboard'],['dreamcast'],
];
const selected=process.argv.slice(2);
if(selected.some(name=>!cases.some(([id])=>id===name)))throw Error('Unknown case model');
const models=selected.length?cases.filter(([id])=>selected.includes(id)):cases;
const pending=new Map();
const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css">
<script>globalThis.OpenCabinetI18n={t:key=>key};</script>
<script src="/src/image-fallbacks.js"></script><script src="/src/dvd-case.js"></script><script src="/src/game-box.js"></script>`;
const server=http.createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(req.method==='POST'&&pathname.startsWith('/export/')) {
      const model=pathname.slice('/export/'.length);
      if(!models.some(([id])=>id===model))throw Error('Unexpected export target');
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>32*1024*1024)throw Error('Model exceeds size limit');chunks.push(chunk);}
      const buffer=Buffer.concat(chunks);
      if(buffer.toString('ascii',0,4)!=='glTF'||buffer.readUInt32LE(8)!==buffer.length)throw Error('Incomplete GLB export');
      const directory=path.join(root,'src/models',model),file=path.join(directory,'case.glb');
      await fs.mkdir(directory,{recursive:true});
      await fs.writeFile(file+'.next',buffer);await fs.rename(file+'.next',file);
      pending.set(model,size);res.writeHead(200).end();return;
    }
    if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    if(pathname==='/exporter.js') {
      const source=await fs.readFile(path.join(root,'node_modules/three/examples/jsm/exporters/GLTFExporter.js'),'utf8');
      res.setHeader('Content-Type','text/javascript');res.end(source.replace("from 'three'","from '/src/vendor/three/three.module.js'"));return;
    }
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    const bytes=await fs.readFile(file);
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:500).end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  const executablePath=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.on('pageerror',error=>console.error(error));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for(const spec of models) {
    await page.evaluate(async([model,platform,rom])=>{
      const THREE=await import('/src/vendor/three/three.module.js');
      const {GLTFExporter}=await import('/exporter.js');
      let asset;
      if(model==='cardboard')asset=(await import('/scripts/model-sources/cardboard.js')).build();
      else if(model==='dreamcast')asset=await (await import('/scripts/model-sources/dreamcast.js')).build();
      else {
        const {convertLegacyCase}=await import('/src/three-legacy-geometry.js');
        asset=convertLegacyCase(()=>OpenCabinet3D.geometrySource({id:'export-'+model,title:'',platform,rom_path:rom||'Game (USA).rom'}),model);
      }
      const scene=asset.scene.clone(true);
      const metadata={version:1,model,sourceUnits:'millimeters',dimensions:asset.manifest.dimensions,spine_fraction:asset.manifest.spine_fraction,...asset.exportData};
      // glTF uses metres. Application controllers use millimetres and undo
      // only this root scale when loading; child meshes and animation agree.
      scene.scale.setScalar(.001);scene.updateMatrix();
      const clips=[];
      if(model==='cardboard')metadata.cardboardMaterials=[...new Set(asset.scene.children.flatMap(mesh=>Array.isArray(mesh.material)?mesh.material:[mesh.material]))].map(material=>material.toJSON());
      else if(model==='dreamcast') {
        const target=scene.getObjectByName('Dreamcast lid');
        clips.push(new THREE.AnimationClip('Open Case',1,[new THREE.QuaternionKeyframeTrack(target.uuid+'.quaternion',[0,1],[0,0,0,1,0,-1,0,0])]));
      } else {
        const times=Array.from({length:121},(_,i)=>i/120),tracks=[];
        for(const part of ['lid','spine']) {
          const target=scene.getObjectByName('Case '+part),positions=[],rotations=[],scale=new THREE.Vector3(),position=new THREE.Vector3(),rotation=new THREE.Quaternion();
          target.userData.casePart=part;target.matrixAutoUpdate=true;
          for(const time of times){asset.pose(time);asset.parts[part].matrix.decompose(position,rotation,scale);positions.push(...position.toArray());rotations.push(...rotation.toArray());}
          tracks.push(new THREE.VectorKeyframeTrack(target.uuid+'.position',times,positions),new THREE.QuaternionKeyframeTrack(target.uuid+'.quaternion',times,rotations));
          asset.pose(0);asset.parts[part].matrix.decompose(target.position,target.quaternion,target.scale);target.updateMatrix();
        }
        scene.getObjectByName('Case tray').userData.casePart='tray';
        clips.push(new THREE.AnimationClip('Open Case',1,tracks));
      }
      scene.userData.opencabinetModel=metadata;
      const placeholders=new Map();
      scene.traverse(node=>{
        node.userData.originalName=node.name;
        if(!node.isMesh)return;
        node.userData.caseMaterial=node.material.name;
        node.userData.castsShadow=node.castShadow;node.userData.receivesShadow=node.receiveShadow;
        node.userData.attributeNames=Object.keys(node.geometry.attributes);
        const name=node.material.name||'Geometry';
        if(!placeholders.has(name)) {
          // glTF preserves the standard plastic properties. Runtime restores
          // optical shaders and additive film, which glTF cannot describe.
          const material=node.material.isMaterial&&!node.material.isShadowMaterial&&node.material.colorWrite!==false
            ?node.material.clone():new THREE.MeshBasicMaterial({name,color:0xffffff,side:THREE.DoubleSide});
          for(const [key,value] of Object.entries(material))if(value?.isTexture)material[key]=null;
          placeholders.set(name,material);
        }
        node.material=placeholders.get(name);
      });
      const binary=await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:false,trs:true,animations:clips});
      const response=await fetch('/export/'+model,{method:'POST',body:binary});if(!response.ok)throw Error(await response.text());
      asset.dispose?.();
      const geometries=new Set();asset.scene.traverse(node=>{if(node.geometry)geometries.add(node.geometry);});geometries.forEach(geometry=>geometry.dispose());
    },spec);
    console.log(`${spec[0]}: ${(pending.get(spec[0])/1024).toFixed(1)} KiB`);
  }
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
