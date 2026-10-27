// UV windows into original images; no artwork files are modified.
export function artworkWindow(kind, {full=false, width=142, depth=10}={}) {
  if(!full || kind==='disc')return {offset:[0,0],repeat:[1,1]};
  const total=2*width+depth;
  if(kind==='cover')return {offset:[(width+depth)/total,0],repeat:[width/total,1]};
  if(kind==='back_cover')return {offset:[0,0],repeat:[width/total,1]};
  return {offset:[width/total,0],repeat:[depth/total,1]};
}
export function chooseArtwork(images) {
  const resolved=globalThis.OpenCabinetImages?.resolve(images) || images;
  const find=kind=>resolved.find(image=>image.kind===kind)?.path || null;
  const full=find('box_full');
  return {cover:full||find('cover'),back_cover:full||find('back_cover'),spine:full||find('spine'),disc:find('disc'),inlay:find('inlay'),full};
}

// A CD tray insert is ~139 x 120 mm, with two ~6 mm folded side strips.
// A cropped back is ~1.16:1; the complete unfolded insert is ~1.26:1.
// Tolerance admits scan borders without treating a full DVD wrap as a CD back.
export function dreamcastInsertWindows(width,height,{inside=false}={}) {
  const ratio=width/height,folded=Number.isFinite(ratio)&&height>0&&ratio>=1.215&&ratio<=1.40;
  const whole={offset:[0,0],repeat:[1,1]};
  if(!folded)return {folded:false,center:whole,left:null,right:null};
  const fold=.40627027/(9.70831919+2*.40627027);
  const left={offset:[0,0],repeat:[fold,1]},right={offset:[1-fold,0],repeat:[fold,1]};
  // Looking at the outside of the back reverses left/right in world space.
  return {folded:true,center:{offset:[fold,0],repeat:[1-2*fold,1]},left:inside?left:right,right:inside?right:left};
}

// Narrow curved Dreamcast bands can shrink below 4% of the cover width. Read
// native 2x2 blocks at 1.5%, rather than averaging the band together with art.
export const dreamcastInsertProbes=[.2,.4,.6,.8].map(y=>({edge:[.015,y],inside:[.35,y]}));
export function dreamcastInsertTheme(samples) {
  if(!Array.isArray(samples)||samples.length!==dreamcastInsertProbes.length)return 'black';
  function white(block) {
    if(!block||block.length!==16)return false;
    let count=0;
    for(let i=0;i<16;i+=4) {
      const r=block[i],g=block[i+1],b=block[i+2];
      if(block[i+3]>=220&&Math.min(r,g,b)>=185&&Math.max(r,g,b)-Math.min(r,g,b)<=45)count++;
    }
    return count>=3;
  }
  let whiteEdges=0,distinctEdges=0;
  for(const sample of samples)if(white(sample.edge)) {
    whiteEdges++;if(!white(sample.inside))distinctEdges++;
  }
  // One damaged sample is harmless. Entirely white art remains inconclusive.
  return whiteEdges>=3&&distinctEdges>=1?'white':'black';
}
