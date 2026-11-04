import { createModelViewer } from './three-gltf-box-viewer.js';
import { loadPreparedCase } from './three-prepared-case.js';

export function createViewer(host, options = {}) {
  return createModelViewer(host, options, {model:'xbox',manual:true,load:()=>loadPreparedCase('xbox')});
}
