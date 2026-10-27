// Prepare local WebGL assets. OBJ parsing happens here, never on game selection.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export const sourceIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11];
// Centers of the two circular hinge pins in the supplied OBJ, not the edge
// of the booklet or of the stationary left-hand column.
export const hinge = [-4.658462285995483, -3.3674923181533813];
export const closingAngle = Math.atan2(5.76538, 6.15702);
const scale = 142 / (4.9389734268 + 4.9753856659);
const center = [-.0182061195, -3.3, 1.0946320295];

function writeChanged(file, bytes) {
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!fs.existsSync(file) || !fs.readFileSync(file).equals(content)) fs.writeFileSync(file, content);
}
export function positionInCase(x, y, z, lid = false) {
  if (lid) {
    const dx = x - hinge[0], dy = y - hinge[1];
    x = hinge[0] + dx * Math.cos(closingAngle) - dy * Math.sin(closingAngle);
    y = hinge[1] + dx * Math.sin(closingAngle) + dy * Math.cos(closingAngle);
  }
  return [(x-center[0])*scale, (z-center[2])*scale, -(y-center[1])*scale];
}

// Preserve complete source assemblies, including the lid's long hinge arms.
// Classifying triangle centroids cuts those arms into moving and fixed pieces.
export function shellParts(geometry,source) {
  if(source) {
    // This OBJ concatenates three vertex blocks: rear shell, complete front
    // shell (including its hinge arms), and a duplicated disc. Keep that
    // authoring boundary instead of slicing solids by world-space coordinates.
    const lines=source.split(/\r?\n/),vertices=lines.filter(line=>line.startsWith('v '));
    if(vertices.length!==26633)throw Error('Dreamcast shell changed: review its rigid vertex groups before preparing it.');
    const parts=new Map();let face=0;
    for(const line of lines)if(line.startsWith('f ')) {
      const indices=line.trim().split(/\s+/).slice(1).map(value=>Number(value.split('/')[0])-1);
      if(indices.length!==3)throw Error('Dreamcast shell requires triangular source faces.');
      const groups=indices.map(index=>index<14625?'base':index<20989?'lid':'disc');
      if(groups.every(part=>part===groups[0])&&groups[0]!=='disc') {
        const p=geometry.attributes.position,i=face*3;
        const a=[0,1,2].map(j=>p.array[(i+1)*3+j]-p.array[i*3+j]),b=[0,1,2].map(j=>p.array[(i+2)*3+j]-p.array[i*3+j]);
        if(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])>1e-8)parts.set(face,groups[0]);
      }
      face++;
    }
    return parts;
  }
  throw Error('The original OBJ is required to identify the rigid shell assemblies.');
}

export function convertDreamcast(directory) {
  const buckets = new Map();
  for (const id of sourceIds) {
    const source=fs.readFileSync(path.join(directory, `model_${id}.obj`), 'utf8');
    const object = new OBJLoader().parse(source);
    object.traverse(mesh => {
      if (!mesh.isMesh) return;
      const { position, normal, uv } = mesh.geometry.attributes;
      const assembly=id===7 ? shellParts(mesh.geometry,source) : null;
      const paperSides=new Map(),foldBounds={};
      if(id===5||id===6)for(let i=0;i<position.count;i+=3) {
        const a=[0,1,2].map(j=>position.array[(i+1)*3+j]-position.array[i*3+j]);
        const b=[0,1,2].map(j=>position.array[(i+2)*3+j]-position.array[i*3+j]);
        if(Math.abs(a[1]*b[2]-a[2]*b[1])<=Math.abs(a[2]*b[0]-a[0]*b[2]))continue;
        const side=(position.getX(i)+position.getX(i+1)+position.getX(i+2))/3<0?'left':'right';
        paperSides.set(i,side);foldBounds[side] ||= {min:Infinity,max:-Infinity};
        for(let j=i;j<i+3;j++) {foldBounds[side].min=Math.min(foldBounds[side].min,position.getY(j));foldBounds[side].max=Math.max(foldBounds[side].max,position.getY(j));}
      }
      const bounds = { min: [Infinity,Infinity], max: [-Infinity,-Infinity] };
      if (uv) for (let i=0;i<uv.count;i++) for (let a=0;a<2;a++) {
        const value = uv.array[i*2+a]; bounds.min[a]=Math.min(bounds.min[a],value); bounds.max[a]=Math.max(bounds.max[a],value);
      }
      for (let i=0;i<position.count;i+=3) {
        if(assembly && !assembly.has(i/3))continue;
        const lid = [2,3,4,11].includes(id) || assembly?.get(i/3)==='lid';
        let material = ({0:'disc',1:'discSilver',2:'pages',3:'manualBack',4:'cover',5:'paper',6:'back_cover',7:'acrylic',8:'hub',11:'ribs'})[id];
        const paperSide=paperSides.get(i)||null;
        if(paperSide)material=(id===5?'paper_spine_':'spine_')+paperSide;
        const key = `${id}:${lid?'lid':'base'}:${material}`;
        if (!buckets.has(key)) buckets.set(key,{name:key,part:lid?'lid':'base',material,vertices:[],indices:[],unique:new Map()});
        const bucket=buckets.get(key);
        for (let j=i;j<i+3;j++) {
          const x=position.getX(j), sy=position.getY(j), z=position.getZ(j);
          const p=positionInCase(x,sy,z,lid);
          let nx=normal.getX(j), ny=normal.getY(j), nz=normal.getZ(j);
          if (lid) { const oldX=nx; nx=oldX*Math.cos(closingAngle)-ny*Math.sin(closingAngle); ny=oldX*Math.sin(closingAngle)+ny*Math.cos(closingAngle); }
          let u=uv ? (uv.getX(j)-bounds.min[0])/(bounds.max[0]-bounds.min[0]||1) : 0;
          let v=uv ? (uv.getY(j)-bounds.min[1])/(bounds.max[1]-bounds.min[1]||1) : 0;
          if (id===5 || id===6) {
            // The supplied back scan is a U-shaped insert: separate its UVs into
            // a full back and two full spines, without baking/cropping any artwork.
            if(paperSide) {
              const bounds=foldBounds[paperSide];u=(sy-bounds.min)/(bounds.max-bounds.min);
              if((id===5 && paperSide==='right') || (id===6 && paperSide==='left'))u=1-u;
            }else u=id===5?(x+4.80438995)/9.69755507:(4.90046644-x)/9.70831919;
            v=id===5?(z+3.06791997)/8.35078359:(z+3.07200980)/8.36005282;
          }
          if (id===0 || id===11) { u=uv.getX(j); v=uv.getY(j); }
          const vertex=[...p,nx,nz,-ny,u,v];
          const hash=vertex.map(n=>n.toFixed(6)).join(',');
          if (!bucket.unique.has(hash)) { bucket.unique.set(hash,bucket.vertices.length/8); bucket.vertices.push(...vertex); }
          bucket.indices.push(bucket.unique.get(hash));
        }
      }
      mesh.geometry.dispose();
    });
  }
  // A fallback branding strip sits behind the fixed clear column. Its narrow
  // standalone textures use the complete UV window, independent of game scans.
  const mark={name:'dreamcast-insert',part:'base',material:'insert',vertices:[],indices:[0,1,2,0,2,3]};
  for(const [x,z,u,v] of [[-4.79,-3.0679,0,0],[-4.125,-3.0679,1,0],[-4.125,5.28286,1,1],[-4.79,5.28286,0,1]]) {
    mark.vertices.push(...positionInCase(x,-3.1905,z),0,0,1,u,v);
  }
  buckets.set(mark.name,mark);
  let offset=0;
  const buffers=[], meshes=[];
  for (const {name,part,material,vertices,indices} of buckets.values()) {
    const vertexBuffer=Buffer.from(new Float32Array(vertices).buffer),indexBuffer=Buffer.from(new Uint32Array(indices).buffer);
    meshes.push({name,part,material,vertexOffset:offset,vertexCount:vertices.length/8,indexOffset:offset+vertexBuffer.length,indexCount:indices.length});
    buffers.push(vertexBuffer,indexBuffer);offset+=vertexBuffer.length+indexBuffer.length;
  }
  return {manifest:{version:3,hinge:positionInCase(hinge[0],hinge[1],center[2]),dimensions:[142,125,10],meshes},binary:Buffer.concat(buffers)};
}

export function prepare() {
  const vendor=path.join(root,'src/vendor/three');fs.mkdirSync(vendor,{recursive:true});
  for (const file of ['three.module.js','three.core.js']) writeChanged(path.join(vendor,file),fs.readFileSync(path.join(root,'node_modules/three/build',file)));
  writeChanged(path.join(vendor,'RoomEnvironment.js'),fs.readFileSync(path.join(root,'node_modules/three/examples/jsm/environments/RoomEnvironment.js'),'utf8').replace("from 'three'","from './three.module.js'"));
  writeChanged(path.join(vendor,'LICENSE'),fs.readFileSync(path.join(root,'node_modules/three/LICENSE')));
  const source=path.join(root,'_modelos/Dreamcast'),destination=path.join(root,'src/models/dreamcast');
  if (!fs.existsSync(source)) { console.log('Dreamcast source models not present; keeping prepared assets, if any.');return; }
  fs.mkdirSync(destination,{recursive:true});
  const fingerprint=crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url)));
  for (const id of sourceIds) fingerprint.update(fs.readFileSync(path.join(source,`model_${id}.obj`)));
  const ribs=fs.readFileSync(path.join(root,'src/assets/textures/cd-case-ribs.svg'));fingerprint.update(ribs);
  const hash=fingerprint.digest('hex'),stamp=path.join(destination,'.source-hash');
  if (fs.existsSync(stamp) && fs.readFileSync(stamp,'utf8')===hash && ['case.json','case.bin','ribs-height.svg'].every(file=>fs.existsSync(path.join(destination,file)))) return;
  const {manifest,binary}=convertDreamcast(source);
  // insert.webp and insert2.webp are supplied assets: never regenerate or overwrite them.
  writeChanged(path.join(destination,'case.bin'),binary);writeChanged(path.join(destination,'case.json'),JSON.stringify(manifest));writeChanged(path.join(destination,'ribs-height.svg'),ribs);writeChanged(stamp,hash);
  console.log(`Dreamcast: ${manifest.meshes.length} parts, ${(binary.length/1024/1024).toFixed(2)} MiB; repeated shell OBJ files omitted.`);
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) prepare();
