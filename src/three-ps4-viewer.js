import { createModelViewer } from './three-gltf-box-viewer.js';
import { loadPreparedCase } from './three-prepared-case.js';

export function createViewer(host, options = {}) {
  return createModelViewer(host, options, {model:'ps4',manual:true,load:()=>loadPreparedCase('ps4')});
}
