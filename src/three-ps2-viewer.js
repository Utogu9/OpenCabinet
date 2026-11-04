import { createModelViewer } from './three-gltf-box-viewer.js';
import { convertLegacyCase } from './three-legacy-geometry.js';

export function createViewer(host,options={}) {
  return createModelViewer(host,options,{model:'ps2',manual:true,build(){
    let source;
    try{return convertLegacyCase(()=>source=globalThis.OpenCabinet3D.geometrySource({id:'ps2-geometry',title:'',platform:'Sony PlayStation 2',rom_path:'case.iso'}),'ps2');}
    catch(error){source?.dispose();throw error;}
  }});
}
