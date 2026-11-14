// Console-owned fallback art. Generated titles are RAM canvases, never new
// library images or modifications of the downloaded source file.
(() => {
  const defaults={font_size:72,x:50,y:5,rotation:90,color:'#000000'};
  const backgrounds=new Map(),prints=new Map();let generation=0;
  const valid=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  function settings(value={}) {
    return {font_size:valid(value.font_size,8,400)?value.font_size:defaults.font_size,x:valid(value.x,0,100)?value.x:defaults.x,y:valid(value.y,0,100)?value.y:defaults.y,
      rotation:[0,90,180,270].includes(value.rotation)?value.rotation:defaults.rotation,color:/^#[\da-f]{6}$/i.test(value.color||'')?value.color:defaults.color};
  }
  function fromDetails(details) {
    const image=details.images?.find(image=>image.kind==='spine'&&image.path);
    return image?{...(details.box_3d||{base:{},regions:{}}),spine_template:{path:image.path,...settings(details.spine_title||{})}}:details.box_3d||null;
  }
  function keep(map,key,value,limit){map.delete(key);map.set(key,value);while(map.size>limit)map.delete(map.keys().next().value);return value;}
  async function background(path,imageSource) {
    if(backgrounds.has(path))return keep(backgrounds,path,backgrounds.get(path),8);
    const task=new Promise((resolve,reject)=>{
      const image=new Image();image.crossOrigin='anonymous';image.decoding='async';image.fetchPriority='low';
      image.onload=()=>{try{
        const horizontal=image.naturalWidth>image.naturalHeight,canvas=document.createElement('canvas');
        canvas.height=2048;canvas.width=Math.max(32,Math.min(512,Math.round(2048*(horizontal?image.naturalHeight/image.naturalWidth:image.naturalWidth/image.naturalHeight))));
        const ctx=canvas.getContext('2d');
        if(horizontal){ctx.translate(0,canvas.height);ctx.rotate(-Math.PI/2);ctx.drawImage(image,0,0,canvas.height,canvas.width);}
        else ctx.drawImage(image,0,0,canvas.width,canvas.height);
        resolve(canvas);
      }catch(error){if(backgrounds.get(path)===task)backgrounds.delete(path);reject(error);}
      };
      image.onerror=()=>{if(backgrounds.get(path)===task)backgrounds.delete(path);reject(Error('Spine image unavailable'));};image.src=imageSource(path);
    });
    return keep(backgrounds,path,task,8);
  }
  function draw(image,title,value,width=image.width,height=2048){
    const options=settings(value),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,width,height);ctx.translate(width*options.x/100,height*options.y/100);ctx.rotate(options.rotation*Math.PI/180);
    ctx.font=`600 ${options.font_size}px Arial, sans-serif`;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle=options.color;ctx.fillText(title,0,0);
    return canvas;
  }
  async function render(template,title,{imageSource=value=>value,signal,profile}={}) {
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    const epoch=generation,base=await background(template.path,imageSource);
    if(signal?.aborted||epoch!==generation)throw new DOMException('Aborted','AbortError');
    const width=profile?Math.max(32,Math.min(512,Math.round(2048*profile.depth/(profile.spineFace==='top'?profile.width:profile.height)))):base.width;
    const key=JSON.stringify([template.path,title,settings(template),width]);
    if(prints.has(key))return keep(prints,key,prints.get(key),24);
    return keep(prints,key,draw(base,title,template,width),24);
  }
  function createEditor({getImages,setImages,imageSource,getTitle,getProfile,addImage}) {
    const get=id=>document.getElementById('platform-spine-'+id),fields=Object.fromEntries(Object.keys(defaults).map(key=>[key,get(key)]));
    let revision=0,active=false;
    async function preview(){
      if(!active)return;const token=++revision,host=get('preview'),image=getImages().find(image=>image.kind==='spine');
      if(!image){host.replaceChildren();host.textContent=globalThis.OpenCabinetI18n.t('spine.noImage');return;}
      try{const canvas=await render({path:image.path,...value()},get('sample').value||getTitle(),{imageSource,profile:getProfile?.()});if(token!==revision||!active)return;
        const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d').drawImage(canvas,0,0);host.replaceChildren(copy);
      }catch{if(token===revision)host.textContent=globalThis.OpenCabinetI18n.t('spine.previewError');}
    }
    function value(){
      const current=Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,key==='color'?field.value:Number(field.value)]));
      if(!valid(current.font_size,8,400)||!valid(current.x,0,100)||!valid(current.y,0,100)||![0,90,180,270].includes(current.rotation)||!/^#[\da-f]{6}$/i.test(current.color))throw Error(globalThis.OpenCabinetI18n.t('spine.invalid'));
      return current;
    }
    function refreshImages(){
      const select=get('image');select.replaceChildren();const images=getImages().filter(image=>image.kind==='spine');
      if(!images.length){const option=document.createElement('option');option.textContent=globalThis.OpenCabinetI18n.t('spine.noImage');select.appendChild(option);}
      for(const image of images){const option=document.createElement('option');option.value=image.path;option.textContent=image.path.split(/[\\/]/).pop();select.appendChild(option);}
      select.disabled=images.length<2;void preview();
    }
    Object.values(fields).forEach(field=>field.addEventListener('input',preview));get('sample').addEventListener('input',preview);
    get('image').addEventListener('change',()=>{const path=get('image').value;setImages([...getImages().filter(image=>image.path===path),...getImages().filter(image=>image.path!==path)]);});
    get('add').addEventListener('click',addImage);
    get('reset').addEventListener('click',()=>{for(const[key,field]of Object.entries(fields))field.value=String(defaults[key]);void preview();});
    return {value,refreshImages,
      open(options){const normalized=settings(options||{});for(const[key,field]of Object.entries(fields))field.value=String(normalized[key]);get('sample').value=getTitle();refreshImages();},
      show(show){active=show;if(show)void preview();else revision++;},
      close(){active=false;revision++;get('preview').replaceChildren();},
    };
  }
  globalThis.OpenCabinetSpines={settings,fromDetails,render,draw,createEditor,clear(){generation++;backgrounds.clear();prints.clear();}};
})();
