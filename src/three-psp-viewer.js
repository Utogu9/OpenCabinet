import { createModelViewer } from './three-gltf-box-viewer.js';

export function createViewer(host, options = {}) {
  return createModelViewer(host, options, { model: 'psp', normalAxis: 'y', spineNormalAxis: 'x', manual: true, plasticHaze: .16 });
}
