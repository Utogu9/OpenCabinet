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
