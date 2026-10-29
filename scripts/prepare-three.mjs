// Bundle Three.js and validate the prepared model assets used by the app.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function writeChanged(file, bytes) {
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!fs.existsSync(file) || !fs.readFileSync(file).equals(content)) fs.writeFileSync(file, content);
}

function validateRuntime(directory) {
  const missing=['case.json','case.bin','insert.webp','insert2.webp','ps1-insert.webp','ribs-height.svg','LICENSE-CC0.txt']
    .filter(file=>!fs.existsSync(path.join(directory,file)));
  if(missing.length)throw Error(`Missing bundled Dreamcast assets: ${missing.join(', ')}`);
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'case.json'),'utf8'));
  const length=fs.statSync(path.join(directory,'case.bin')).size;
  if(manifest.version!==3||!Array.isArray(manifest.meshes)||!manifest.meshes.length||manifest.meshes.some(mesh=>
    !Number.isInteger(mesh.vertexOffset)||mesh.vertexOffset<0||!Number.isInteger(mesh.vertexCount)||mesh.vertexCount<1
    ||!Number.isInteger(mesh.indexOffset)||mesh.indexOffset<0||!Number.isInteger(mesh.indexCount)||mesh.indexCount<3
    ||mesh.vertexOffset+mesh.vertexCount*32>length||mesh.indexOffset+mesh.indexCount*4>length)) {
    throw Error('The bundled Dreamcast geometry is incomplete or has an unsupported format.');
  }
}

export function prepare({projectRoot=root,dependencyRoot=path.join(projectRoot,'node_modules/three')}={}) {
  // Optional locally supplied models are never downloaded or required by builds.
  const localModels=Object.fromEntries(['switch','psp'].map(model=>[model,
    ['case.json','case.glb'].every(file=>fs.existsSync(path.join(projectRoot,'src/models',model,file)))]));
  writeChanged(path.join(projectRoot,'src/local-models.js'),'// Generated locally by prepare:three.\nglobalThis.OpenCabinetLocalModels = '+JSON.stringify(localModels)+';\n');
  const vendor=path.join(projectRoot,'src/vendor/three');fs.mkdirSync(vendor,{recursive:true});
  for (const file of ['three.module.js','three.core.js']) writeChanged(path.join(vendor,file),fs.readFileSync(path.join(dependencyRoot,'build',file)));
  writeChanged(path.join(vendor,'RoomEnvironment.js'),fs.readFileSync(path.join(dependencyRoot,'examples/jsm/environments/RoomEnvironment.js'),'utf8').replace("from 'three'","from './three.module.js'"));
  for(const [source,target] of [['loaders/GLTFLoader.js','GLTFLoader.js'],['utils/BufferGeometryUtils.js','BufferGeometryUtils.js'],['utils/SkeletonUtils.js','SkeletonUtils.js']]) {
    const content=fs.readFileSync(path.join(dependencyRoot,'examples/jsm',source),'utf8')
      .replaceAll("from 'three'","from './three.module.js'")
      .replaceAll("from '../utils/BufferGeometryUtils.js'","from './BufferGeometryUtils.js'")
      .replaceAll("from '../utils/SkeletonUtils.js'","from './SkeletonUtils.js'");
    writeChanged(path.join(vendor,target),content);
  }
  writeChanged(path.join(vendor,'LICENSE'),fs.readFileSync(path.join(dependencyRoot,'LICENSE')));
  const destination=path.join(projectRoot,'src/models/dreamcast');
  fs.mkdirSync(destination,{recursive:true});
  const ribs=fs.readFileSync(path.join(projectRoot,'src/assets/textures/cd-case-ribs.svg'));
  writeChanged(path.join(destination,'ribs-height.svg'),ribs);
  validateRuntime(destination);
  console.log('Using the bundled Dreamcast model.');
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) prepare();
