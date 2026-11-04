import { createModelViewer } from './three-gltf-box-viewer.js';
import { convertLegacyCase } from './three-legacy-geometry.js';

// Xbox and Xbox 360 share the DVD construction. Their green tint and haze
// follow the selected platform without rebuilding the case or WebGL context.
export function createViewer(host,options={}) {
  return createModelViewer(host,options,{model:'xbox',manual:true,build(){
    let source;
    try{return convertLegacyCase(()=>source=globalThis.OpenCabinet3D.geometrySource({id:'xbox-geometry',title:'',platform:'Microsoft Xbox',rom_path:'case.iso'}),'xbox');}
    catch(error){source?.dispose();throw error;}
  }});
}
