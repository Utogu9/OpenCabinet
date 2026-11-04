import { createModelViewer } from './three-gltf-box-viewer.js';
import { convertLegacyCase } from './three-legacy-geometry.js';

// PS4 and PS5 share the same molded blue Blu-ray case and opening rig.
export function createViewer(host,options={}) {
  return createModelViewer(host,options,{model:'ps4',manual:true,build(){
    let source;
    try{return convertLegacyCase(()=>source=globalThis.OpenCabinet3D.geometrySource({id:'ps4-geometry',title:'',platform:'Sony PlayStation 4',rom_path:'case.iso'}),'ps4');}
    catch(error){source?.dispose();throw error;}
  }});
}
