import { createModelViewer } from './three-gltf-box-viewer.js';
import { convertLegacyCase } from './three-legacy-geometry.js';

const families={
  genesis:{model:'genesis',platform:'Sega Mega Drive / Genesis'},
  wii:{model:'wii',platform:'Nintendo Wii'},
  wiiu:{model:'wiiu',platform:'Nintendo Wii U'},
  gamecube:{model:'gamecube',platform:'Nintendo GameCube'},
  gameCubeJapan:{model:'gamecube-japan',platform:'Nintendo GameCube',rom:'Game (Japan).iso'},
  ds:{model:'ds',platform:'Nintendo DS'},
  dsPal:{model:'ds-pal',platform:'Nintendo DS',rom:'Game (Europe).nds'},
  threeDs:{model:'3ds',platform:'Nintendo 3DS'},
  longbox:{model:'longbox',platform:'Sega Saturn'},
};
export function createViewer(host,options={}) {
  const game=options.initialGame,settings=globalThis.OpenCabinet3D.resolveSettings(options.initialSettings,game.box_3d);
  const profile=globalThis.OpenCabinet3D.profileFor(game.platform,null,game.rom_path,settings);
  const spec=families[profile.id==='dvd'?profile.variant:profile.id];
  if(!spec)throw Error('Unsupported converted case family');
  return createModelViewer(host,options,{model:spec.model,manual:true,build(){
    let source;
    try{return convertLegacyCase(()=>source=globalThis.OpenCabinet3D.geometrySource({id:spec.model+'-geometry',title:'',platform:spec.platform,rom_path:spec.rom||'Game (USA).rom'}),spec.model);}
    catch(error){source?.dispose();throw error;}
  }});
}
