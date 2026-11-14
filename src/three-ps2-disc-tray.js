import * as THREE from './vendor/three/three.module.js';
import {loadPreparedModel} from './three-prepared-model.js';
import {createDiscMaterial} from './three-disc-material.js';
import {applyDiscFinish,discFinish} from './three-disc-interaction.js';

// Regions are editions, not extra physical discs. Only inspect the selected
// edition's own source associations; never flatten game.regions or native ports.
export function ps2DiscSources(game){
  const selected=game?.regions?.find(region=>region.game.id===game.default_region_id)?.game||game;
  if(!selected||selected.launch_directly||!/^(?:sony)?(?:playstation2|ps2)$/.test(String(selected.platform||'').toLowerCase().replace(/[^a-z0-9]/g,'')))return [];
  const sources=(selected.discs||[]).filter(disc=>disc.rom_path);
  return sources.length===2&&new Set(sources.map(disc=>disc.rom_path)).size===2?sources:[];
}

export function createPS2DiscTray({model,parts,meshes,materials,schedule,onReady=()=>{},getEnvironment}){
  const main=meshes.filter(mesh=>['UMD Label','Disc Silver'].includes(mesh.material?.name));
  let sources=[],entries=null,loading=null,disposed=false,loaded=false,target=false,amount=0,animation=null;
  let anchor=null,compensator=null,axis=null,swing=null,carrier=[],secondary=[],owned=[];
  const label=createDiscMaterial(),silver=createDiscMaterial({silver:true});label.name='Disc 2 Label';silver.name='Disc 2 Silver';
  const worldInverse=new THREE.Matrix4(),toModel=new THREE.Matrix4();
  function configureEntries(){entries=loaded&&sources.length===2?sources.map((source,i)=>({id:String(source.id??source.rom_path),label:source.label||globalThis.OpenCabinetI18n.t('disc.numbered',i+1),meshes:i?secondary:main})):null;}
  async function ensure(){
    if(loaded)return;
    if(!loading)loading=loadPreparedModel('ps2-disc-tray').then(asset=>{
      if(disposed){asset.scene.traverse(node=>{node.geometry?.dispose();node.material?.dispose();});return;}
      anchor=new THREE.Group();anchor.name='PS2 Tray Spine Mount';anchor.position.fromArray(asset.manifest.spineMount);parts.spine.add(anchor);
      axis=new THREE.Group();axis.name='PS2 Tray Hinge';axis.position.fromArray(asset.manifest.hingeOffset);anchor.add(axis);
      compensator=new THREE.Group();axis.add(compensator);
      swing=new THREE.Group();swing.name='PS2 Disc Carrier';compensator.add(swing);
      asset.scene.traverse(node=>{if(!node.isMesh)return;node.material.dispose();node.material=materials.get('Case Plastic');node.castShadow=node.receiveShadow=true;carrier.push(node);owned.push(node);});
      carrier.forEach(node=>(node.userData.trayPart==='mount'?axis:swing).add(node));
      const firstLabel=main.find(mesh=>mesh.material.name==='UMD Label');firstLabel.geometry.computeBoundingBox();
      const shift=new THREE.Vector3(...asset.manifest.discCenter).sub(firstLabel.geometry.boundingBox.getCenter(new THREE.Vector3()));
      for(const source of main){const geometry=source.geometry.clone();geometry.translate(...shift.toArray());
        const mesh=new THREE.Mesh(geometry,source.material.name==='UMD Label'?label:silver);mesh.name='PS2 Second '+source.material.name;
        mesh.castShadow=mesh.receiveShadow=true;swing.add(mesh);secondary.push(mesh);owned.push(mesh);
      }
      meshes.push(...owned);materials.set(label.name,label);materials.set(silver.name,silver);loaded=true;
      axis.visible=sources.length===2;configureEntries();onReady();schedule();
    }).catch(error=>{loading=null;if(!disposed)console.warn('PS2 disc tray:',error);});
    await loading;
  }
  function update(game,nextProfile){
    sources=ps2DiscSources(game);target=false;amount=0;animation=null;
    const finish=discFinish(nextProfile,game);applyDiscFinish(silver,finish);label.envMap=silver.envMap=getEnvironment();
    if(axis){axis.visible=sources.length===2;swing.rotation.y=0;}
    configureEntries();if(sources.length===2)void ensure();schedule();
  }
  function frame(time,opened){
    if(!loaded||!axis.visible)return;
    if(opened<.01){amount=0;target=false;animation=null;}
    if(animation){animation.start??=time;const p=Math.min(1,(time-animation.start)/520),ease=p*p*(3-2*p);amount=THREE.MathUtils.lerp(animation.from,animation.to,ease);if(p===1)animation=null;else schedule();}
    // The mounts and projecting hinge follow the centre of the actual spine.
    // Only the carrier cancels the spine's orientation. As the spine unfolds,
    // its centre shifts left, naturally exposing the original disc's right edge.
    const lid=parts.lid.quaternion,lidAngle=Math.abs(Math.atan2(2*lid.w*lid.y,1-2*lid.y*lid.y));
    // Rest above the opened lid/booklet, including this case's slight opening
    // stop angle. A flat 180-degree carrier would cut underneath the booklet.
    compensator.quaternion.copy(parts.spine.quaternion).invert();swing.rotation.y=-lidAngle*amount;
    axis.updateWorldMatrix(true,true);
  }
  function toggle(opened){
    if(!entries||opened<.98)return false;target=!target;
    const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    animation=reduced?null:{from:amount,to:Number(target),start:null};if(reduced)amount=Number(target);schedule();return true;
  }
  function expandBounds(bounds){
    if(!axis?.visible)return;axis.updateWorldMatrix(true,true);worldInverse.copy(model.matrixWorld).invert();
    for(const mesh of owned){if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();toModel.multiplyMatrices(worldInverse,mesh.matrixWorld);bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(toModel));}
  }
  return {update,frame,toggle,expandBounds,get entries(){return entries;},get ready(){return !!entries;},get wantsSecond(){return sources.length===2;},get turned(){return target;},get moving(){return !!animation;},
    get carrier(){return carrier;},get secondary(){return secondary;},get object(){return axis;},get swing(){return swing;},
    get lightingKey(){return axis?.visible?[swing.rotation.y,...secondary.map(mesh=>mesh.visible)].join(','):'';},
    clear(){sources=[];entries=null;target=false;amount=0;animation=null;if(axis){axis.visible=false;swing.rotation.y=0;}},
    dispose(){disposed=true;this.clear();anchor?.removeFromParent();for(const mesh of owned){mesh.geometry.dispose();const index=meshes.indexOf(mesh);if(index>=0)meshes.splice(index,1);}if(!loaded){label.dispose();silver.dispose();}}
  };
}
