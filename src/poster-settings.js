// Poster choices belong to the edited game, independently of its box preset.
(() => {
  const defaults={columns:2,rows:2,rotation:0,corner:'top_left',first_side:'front',fold_order:'rows_first'};
  const choices={rotation:[0,90,180,270],corner:['top_left','top_right','bottom_left','bottom_right'],first_side:['front','back'],fold_order:['rows_first','columns_first']};
  function settings(box) {
    const value=box?.poster||{columns:box?.base?.poster_columns,rows:box?.base?.poster_rows};
    return Object.fromEntries(Object.entries(defaults).map(([key,fallback])=>[key,
      key==='columns'||key==='rows'?(Number.isInteger(value[key])&&value[key]>=1&&value[key]<=8?value[key]:fallback)
      :choices[key].includes(value[key])?value[key]:fallback]));
  }
  function withoutPoster(box) {
    if(!box)return null;
    const clean=style=>Object.fromEntries(Object.entries(style||{}).filter(([key])=>!key.startsWith('poster_')));
    return {base:clean(box.base),regions:Object.fromEntries(Object.entries(box.regions||{}).map(([key,value])=>[key,clean(value)]))};
  }
  function hasBoxStyle(box) {
    const value=withoutPoster(box);
    return !!value&&[value.base,...Object.values(value.regions)].some(style=>Object.values(style).some(value=>value!=null));
  }
  function withPoster(box,poster) {
    const result=withoutPoster(box)||{base:{},regions:{}};
    if(poster)result.poster={...poster};
    return poster||hasBoxStyle(result)?result:null;
  }
  function createEditor({getImages,setImages,imageSource,addImages,isBusy=()=>false}) {
    const get=id=>document.getElementById('game-poster-'+id),t=(key,...args)=>globalThis.OpenCabinetI18n.t(key,...args);
    const controls=Object.fromEntries(Object.keys(defaults).map(key=>[key,get(key)]));
    for(const side of ['front','back'])get('add-'+side).addEventListener('click',()=>{if(!isBusy())addImages('poster_'+side);});
    function render() {
      const panels=document.getElementById('game-editor-panels'),scroll=panels.scrollTop;
      for(const side of ['front','back']){
        const kind='poster_'+side,images=getImages().filter(image=>image.kind===kind),preview=get('image-'+side),select=get('image-select-'+side);
        preview.replaceChildren();select.replaceChildren();select.disabled=isBusy()||images.length<2;
        if(images.length){
          const img=document.createElement('img');img.src=imageSource(images[0].path);img.alt=t(side==='front'?'image.kind.posterFront':'image.kind.posterBack');img.decoding='async';preview.appendChild(img);
          for(const image of images){const option=document.createElement('option');option.value=image.path;option.textContent=image.path.split(/[\\/]/).pop();select.appendChild(option);}
        }else{preview.textContent=t('poster.noImage');const option=document.createElement('option');option.textContent=t('poster.noImage');select.appendChild(option);}
        select.onchange=()=>{if(!isBusy())setImages([...getImages().filter(image=>image.path===select.value),...getImages().filter(image=>image.path!==select.value)]);};
        get('add-'+side).disabled=isBusy();
      }
      panels.scrollTop=scroll;
    }
    function setBusy(busy) {
      Object.values(controls).forEach(control=>{control.disabled=busy;});
      for(const side of ['front','back']){get('add-'+side).disabled=busy;get('image-select-'+side).disabled=busy||getImages().filter(image=>image.kind==='poster_'+side).length<2;}
    }
    return {
      open(box){const value=settings(box);for(const [key,control] of Object.entries(controls))control.value=String(value[key]);render();},
      render,setBusy,
      value(){const value=Object.fromEntries(Object.entries(controls).map(([key,control])=>[key,['columns','rows','rotation'].includes(key)?Number(control.value):control.value]));
        if([value.columns,value.rows].some(v=>!Number.isInteger(v)||v<1||v>8))throw Error(t('poster.invalidFolds'));
        if(Object.entries(choices).some(([key,values])=>!values.includes(value[key])))throw Error(t('poster.invalidSettings'));
        return Object.keys(defaults).every(key=>value[key]===defaults[key])?null:value;
      },
    };
  }
  globalThis.OpenCabinetPosters={settings,withoutPoster,withPoster,hasBoxStyle,createEditor};
})();
