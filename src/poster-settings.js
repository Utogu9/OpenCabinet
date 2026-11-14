// Poster pairs and their folds belong to the game, independently of its box preset.
(() => {
  const defaults={columns:2,rows:2,rotation:0,corner:'top_left',first_side:'front',fold_order:'rows_first'};
  const choices={rotation:[0,90,180,270],corner:['top_left','top_right','bottom_left','bottom_right'],first_side:['front','back'],fold_order:['rows_first','columns_first']};
  const normalize=value=>Object.fromEntries(Object.entries(defaults).map(([key,fallback])=>[key,
    key==='columns'||key==='rows'?(Number.isInteger(value?.[key])&&value[key]>=1&&value[key]<=8?value[key]:fallback)
    :choices[key].includes(value?.[key])?value[key]:fallback]));
  function settings(box){return normalize(box?.poster||{columns:box?.base?.poster_columns,rows:box?.base?.poster_rows});}
  const sideOf=image=>image.kind==='poster'?'front':image.kind.match(/^poster_(front|back)(?:\d+)?$/)?.[1];
  const pathKey=path=>String(path||'').replace(/\\/g,'/');
  function resolveImage(path,images,side){
    if(!path)return null;const key=pathKey(path),available=images.filter(image=>sideOf(image)===side);
    const exact=available.find(image=>pathKey(image.path)===key||pathKey(image.path).endsWith('/'+key));if(exact)return exact.path;
    const filename=key.split('/').pop(),matches=available.filter(image=>pathKey(image.path).split('/').pop()===filename);
    return matches.length===1?matches[0].path:null;
  }
  function automatic(images,folds=defaults){
    const pairs=new Map(),counts={front:0,back:0};
    for(const image of images){const side=sideOf(image);if(!side)continue;
      const number=pathKey(image.path).split('/').pop().match(/(?:poster|post)[ _-]?(?:front|back)[ _-]?(\d+)?(?=\.[^.]+$|$)/i)?.[1]
        ||image.kind.match(/^poster_(?:front|back)(\d+)$/)?.[1];
      let index=number?Number(number):++counts[side];
      while(pairs.get(index)?.[side])index++;
      if(!pairs.has(index))pairs.set(index,{id:'auto-'+index,name:'',front:null,back:null,settings:{...folds}});
      pairs.get(index)[side]=image.path;
    }
    return [...pairs.entries()].sort(([a],[b])=>a-b).map(([,pair])=>pair);
  }
  function collection(box,images,{keepEmpty=false}={}){
    if(!Array.isArray(box?.posters))return automatic(images,settings(box));
    return box.posters.map(entry=>({...entry,settings:normalize(entry.settings),front:resolveImage(entry.front,images,'front'),back:resolveImage(entry.back,images,'back')})).filter(entry=>keepEmpty||entry.front||entry.back);
  }
  function withoutPoster(box) {
    if(!box)return null;
    const clean=style=>Object.fromEntries(Object.entries(style||{}).filter(([key])=>!key.startsWith('poster_')));
    return {base:clean(box.base),regions:Object.fromEntries(Object.entries(box.regions||{}).map(([key,value])=>[key,clean(value)]))};
  }
  function hasBoxStyle(box) {const value=withoutPoster(box);return !!value&&[value.base,...Object.values(value.regions)].some(style=>Object.values(style).some(value=>value!=null));}
  function withPoster(box,poster) {
    const result=withoutPoster(box)||{base:{},regions:{}};
    if(Array.isArray(poster))result.posters=poster.map(entry=>({...entry,settings:{...entry.settings}}));
    else if(poster)result.poster={...poster};
    return poster||hasBoxStyle(result)?result:null;
  }
  function createEditor({getImages,setImages,imageSource,addImages,isBusy=()=>false}) {
    const get=id=>document.getElementById('game-poster-'+id),t=(key,...args)=>globalThis.OpenCabinetI18n.t(key,...args);
    const controls=Object.fromEntries(Object.keys(defaults).map(key=>[key,get(key)]));
    let items=[],selected=null,known=new Set(),busy=false;
    const current=()=>items.find(item=>item.id===selected);
    const fresh=()=>({id:globalThis.crypto?.randomUUID?.()||'poster-'+Date.now()+'-'+Math.random().toString(36).slice(2),name:'',front:null,back:null,settings:{...defaults}});
    function read(){const entry=current();if(!entry)return;entry.name=get('name').value;entry.settings=Object.fromEntries(Object.entries(controls).map(([key,control])=>[key,['columns','rows','rotation'].includes(key)?Number(control.value):control.value]));}
    function display(){const entry=current();get('name').value=entry?.name||'';for(const [key,control]of Object.entries(controls))control.value=String(entry?.settings[key]??defaults[key]);render();}
    for(const control of Object.values(controls))control.addEventListener('input',read);
    get('name').addEventListener('input',()=>{read();const option=get('select').selectedOptions[0];if(option)option.textContent=current().name||t('poster.numbered',items.indexOf(current())+1);});
    get('select').onchange=()=>{read();selected=get('select').value;display();};
    get('new').onclick=()=>{if(isBusy())return;read();const entry=fresh();items.push(entry);selected=entry.id;display();};
    get('remove').onclick=()=>{if(isBusy())return;const index=items.findIndex(item=>item.id===selected);items.splice(index,1);selected=items[Math.min(index,items.length-1)]?.id||null;display();};
    for(const [id,delta]of [['up',-1],['down',1]])get(id).onclick=()=>{if(isBusy())return;read();const index=items.findIndex(item=>item.id===selected),target=index+delta;if(target<0||target>=items.length)return;[items[index],items[target]]=[items[target],items[index]];render();};
    for(const side of ['front','back'])get('add-'+side).addEventListener('click',()=>{if(!isBusy())addImages('poster_'+side);});
    function render() {
      const panels=document.getElementById('game-editor-panels'),scroll=panels.scrollTop,images=getImages();
      // A removed pairing never deletes artwork or silently recreates itself.
      const added=images.filter(image=>sideOf(image)&&!known.has(image.path+'|'+sideOf(image)));known=new Set(images.filter(sideOf).map(image=>image.path+'|'+sideOf(image)));
      const used=new Set(items.flatMap(item=>[item.front,item.back]).filter(Boolean));
      for(const pair of automatic(added.filter(image=>!used.has(image.path)))){
        const empty=current()&&(!pair.front||!current().front)&&(!pair.back||!current().back)?current():null;
        if(empty){empty.front=pair.front||empty.front;empty.back=pair.back||empty.back;}else items.push({...pair,id:fresh().id});
      }
      for(const item of items)for(const side of ['front','back'])item[side]=resolveImage(item[side],images,side);
      selected=items.some(item=>item.id===selected)?selected:items[0]?.id||null;
      const entry=current(),select=get('select');select.replaceChildren();
      items.forEach((item,index)=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.name||t('poster.numbered',index+1);select.appendChild(option);});select.value=selected||'';
      for(const side of ['front','back']){
        const available=images.filter(image=>sideOf(image)===side),preview=get('image-'+side),pick=get('image-select-'+side);
        preview.replaceChildren();pick.replaceChildren();const none=document.createElement('option');none.value='';none.textContent=t('poster.noImage');pick.appendChild(none);
        const path=entry?.[side];if(path){const img=document.createElement('img');img.src=imageSource(path);img.alt=t(side==='front'?'poster.front':'poster.back');img.decoding='async';preview.appendChild(img);}else preview.textContent=t('poster.noImage');
        for(const image of available){const option=document.createElement('option');option.value=image.path;option.textContent=pathKey(image.path).split('/').pop();pick.appendChild(option);}pick.value=path||'';
        pick.onchange=()=>{read();if(current())current()[side]=pick.value||null;render();};
      }
      setBusy(busy);panels.scrollTop=scroll;
    }
    function setBusy(value) {
      busy=value;const disabled=busy||isBusy(),entry=current(),index=items.indexOf(entry);
      Object.values(controls).forEach(control=>{control.disabled=disabled||!entry;if('required'in control)control.required=!!entry;});
      get('select').disabled=disabled||items.length<2;get('name').disabled=disabled||!entry;get('new').disabled=disabled;
      get('remove').disabled=disabled||!entry;get('up').disabled=disabled||index<=0;get('down').disabled=disabled||index<0||index===items.length-1;
      for(const side of ['front','back']){get('add-'+side).disabled=disabled;get('image-select-'+side).disabled=disabled||!entry;}
    }
    return {
      open(box){items=collection(box,getImages(),{keepEmpty:true});if(!items.length&&!Array.isArray(box?.posters)){const entry=fresh();entry.settings=settings(box);items.push(entry);}selected=items[0]?.id||null;known=new Set(getImages().filter(sideOf).map(image=>image.path+'|'+sideOf(image)));display();},
      render,setBusy,
      value(){read();for(const item of items){const value=item.settings;
        if([value.columns,value.rows].some(v=>!Number.isInteger(v)||v<1||v>8))throw Error(t('poster.invalidFolds'));
        if(Object.entries(choices).some(([key,values])=>!values.includes(value[key])))throw Error(t('poster.invalidSettings'));
      }
        const result=items.filter(item=>item.front||item.back||item.name||Object.keys(defaults).some(key=>item.settings[key]!==defaults[key])).map(item=>({...item,settings:{...item.settings}}));
        return result.length||getImages().some(sideOf)?result:null;
      },
    };
  }
  globalThis.OpenCabinetPosters={settings,collection,automatic,resolveImage,withoutPoster,withPoster,hasBoxStyle,createEditor};
})();
