import { createModelViewer } from './three-gltf-box-viewer.js';
import { convertLegacyCase } from './three-legacy-geometry.js';

export function createViewer(host, options = {}) {
  return createModelViewer(host, options, { model:'psp',manual:true,build(){
    let source;
    try{return convertLegacyCase(()=>source=globalThis.OpenCabinet3D.geometrySource({id:'psp-geometry',title:'',platform:'Sony PSP'}),'psp');}
    catch(error){source?.dispose();throw error;}
  }});
}
