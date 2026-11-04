import * as THREE from './vendor/three/three.module.js';

// The printed label still catches light from the disc underneath it. Keep the
// same optical finish across imported and converted CD/DVD/Blu-ray cases.
export function createDiscMaterial({silver=false}={}) {
  return new THREE.MeshStandardMaterial({color:silver?0xc3cedb:0xbbc5d5,
    metalness:silver?.9:.45,roughness:silver?.19:.25,side:THREE.DoubleSide});
}
