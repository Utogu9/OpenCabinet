import fs from 'node:fs';

export const preparedModels=['dvd','ps2','ps3','ps4','xbox','psp','genesis','wii','wiiu','gamecube','gamecube-japan','ds','ds-pal','3ds','longbox','cardboard','dreamcast'];

// Validate the distributed artifact, without a browser or any authoring source.
export function readModel(file,model) {
  try {
    const bytes=fs.readFileSync(file);
    if(bytes.length<28||bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw Error('header');
    const length=bytes.readUInt32LE(12),end=20+length;
    if(length%4||bytes.toString('ascii',16,20)!=='JSON'||end+8>bytes.length)throw Error('JSON chunk');
    const json=JSON.parse(bytes.toString('utf8',20,end));
    if(bytes.readUInt32LE(end+4)!==0x004e4942||end+8+bytes.readUInt32LE(end)!==bytes.length)throw Error('binary chunk');
    const bufferLength=json.buffers?.[0]?.byteLength;
    if(!Number.isInteger(bufferLength)||bufferLength<1||bufferLength>bytes.readUInt32LE(end)||json.buffers.length!==1||json.buffers[0].uri)throw Error('buffer');
    if((json.images||[]).some(image=>image.uri))throw Error('external textures');
    for(const view of json.bufferViews||[]) {
      if(view.buffer!==0||!Number.isInteger(view.byteLength)||view.byteLength<1||(view.byteOffset||0)<0||(view.byteOffset||0)+view.byteLength>bufferLength)throw Error('buffer view');
    }
    const manifest=json.nodes?.map(node=>node.extras?.opencabinetModel).find(Boolean);
    if(manifest?.version!==1||manifest.model!==model||manifest.dimensions?.length!==3||!manifest.dimensions.every(n=>Number.isFinite(n)&&n>0))throw Error('manifest');
    if(!json.meshes?.length||json.meshes.some(mesh=>!mesh.primitives?.length||mesh.primitives.some(primitive=>!json.accessors?.[primitive.attributes?.POSITION]?.count)))throw Error('meshes');
    if(model!=='cardboard'&&!json.animations?.some(animation=>animation.name==='Open Case'&&animation.channels?.length))throw Error('opening rig');
    return {manifest,json,bytes};
  }catch(error){throw Error(`The bundled ${model} geometry is incomplete or has an unsupported format (${error.message}).`);}
}
