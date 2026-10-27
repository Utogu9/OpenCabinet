// PDF previews share the image cache's bounded RAM layer and disk settings.
// Warm only page 1, one PDF at a time; selected games still receive the full
// preview object from PDF.js so the existing reader/back-cover flow is intact.
(() => {
  const validMode=value=>['auto','full','left','right'].includes(value)?value:'auto';
  function cancelled(){return new DOMException('Aborted','AbortError');}
  async function thumbnail(front,signal) {
    const canvas=document.createElement('canvas');
    const scale=Math.min(1,800/front.width,800/front.height);
    canvas.width=Math.max(1,Math.round(front.width*scale));canvas.height=Math.max(1,Math.round(front.height*scale));
    canvas.getContext('2d').drawImage(front,0,0,canvas.width,canvas.height);
    let bitmap;
    try {
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.9));
      if(signal.aborted)throw cancelled();
      if(!blob||blob.type!=='image/webp')throw Error('WebP encoding unavailable');
      bitmap=await createImageBitmap(canvas);
      const bytes=new Uint8Array(await blob.arrayBuffer());
      if(signal.aborted)throw cancelled();
      return {bitmap,bytes};
    }catch(error){bitmap?.close();throw error;}
    finally{canvas.width=canvas.height=0;}
  }
  function create({cache,decode,render,lookup,store,toUrl,getManuals,getCoverMode=()=> 'auto',disk=true,
    makeThumbnail=thumbnail,onError=()=>{},delay=1500}) {
    const controller=new AbortController(),seen=new Set(),queued=[],prepared=new Set(),known=new Map(),games=new Map();
    let timer=null,running=false,disposed=false,scrolling=false,scrollTimer=null;
    const check=signal=>{if(disposed||controller.signal.aborted||signal?.aborted)throw cancelled();};
    const keyFor=(path,mode,entry)=>JSON.stringify(['manual-cover-v1',path,mode,entry?.key||'ram']);
    const sourceFor=(path,mode)=>JSON.stringify([path,mode]);
    function note(path,mode,entry){known.set(sourceFor(path,mode),{entry,key:keyFor(path,mode,entry)});return entry;}
    async function entryFor(path,mode,signal) {
      check(signal);if(!disk)return note(path,mode,null);
      try{const entry=await lookup(path,mode);check(signal);return note(path,mode,entry);}
      catch(error){check(signal);onError(error);return null;}
    }
    async function preview(path,mode,entry,signal) {
      check(signal);const key=keyFor(path,mode,entry),ready=cache.get(key);
      if(ready)return ready;
      if(!entry?.cached)return null;
      try{return await cache.load(key,signal,()=>decode(toUrl(entry.path),signal,null,{fullCover:true}));}
      catch(error){check(signal);entry.cached=false;return null;}
    }
    function showKnown(path,mode,signal,onPreview) {
      if(!onPreview||disposed||signal?.aborted)return;
      const source=known.get(sourceFor(path,mode));if(!source)return;
      const image=cache.get(source.key);
      if(image){onPreview(image);return;}
      if(source.entry?.cached)void preview(path,mode,source.entry,signal).then(image=>{
        check(signal);
        if(image&&known.get(sourceFor(path,mode))?.key===source.key)onPreview(image);
      }).catch(error=>{if(error.name!=='AbortError')onError(error);});
    }
    async function remember(path,mode,entry,front,signal) {
      check(signal);const key=keyFor(path,mode,entry);
      if(cache.get(key))return;
      const result=await makeThumbnail(front,signal);
      try{check(signal);}catch(error){result.bitmap.close();throw error;}
      cache.put(key,result.bitmap);
      if(disk&&entry) {
        try{await store(path,mode,entry.key,result.bytes);entry.cached=true;}
        catch(error){check(signal);onError(error);}
      }
    }
    async function load(path,{signal,coverMode='auto',onPreview,...options}={}) {
      signal ||= controller.signal;const mode=validMode(coverMode);
      let shown=null;
      const show=image=>{if(image&&image!==shown){shown=image;onPreview?.(image);}};
      // Reuse prepared pixels before any filesystem query. Validation and the
      // full PDF still run below, without delaying the first visible frame.
      showKnown(path,mode,signal,show);
      let entry;
      try{entry=await entryFor(path,mode,signal);}
      catch(error){if(signal.aborted)throw error;}
      // A miss must not parse the PDF a second time beside the original render.
      // Cache hits race the original, with stale responses rejected by the viewer.
      const quick=preview(path,mode,entry,signal).then(image=>{check(signal);show(image);}).catch(error=>{
        if(error.name!=='AbortError')onError(error);
      });
      const result=await render(path,{...options,signal,coverMode:mode});
      if(signal.aborted){result?.dispose();throw cancelled();}
      if(result&&!disposed)void quick.then(()=>{
        check(signal);
        if(!entry?.cached)return remember(path,mode,entry,result.front,signal);
      }).catch(error=>{if(error.name!=='AbortError')onError(error);});
      return result;
    }
    async function warmPath(path,signal) {
      const mode=validMode(getCoverMode(path)),entry=await entryFor(path,mode,signal),key=keyFor(path,mode,entry);
      if(prepared.has(key)||await preview(path,mode,entry,signal))return;
      let result;
      try {
        result=await render(path,{signal,coverMode:mode,maxSide:800});check(signal);
        await remember(path,mode,entry,result.front,signal);prepared.add(key);
      }finally{result?.dispose();}
    }
    function schedule(wait=75) {
      if(disposed||running||timer!==null||!queued.length||scrolling)return;
      timer=setTimeout(()=>{timer=null;void pump();},wait);
    }
    async function pump() {
      if(disposed||scrolling||running)return;
      const job=queued.shift();if(job===undefined)return;running=true;
      try {
        const paths=typeof job==='object'?job.paths:await getManuals(job);check(controller.signal);
        if(typeof job!=='object')games.set(job,[...paths]);
        for(let index=0;index<paths.length;index++) {
          check(controller.signal);
          if(scrolling){queued.unshift({paths:paths.slice(index)});break;}
          try{await warmPath(paths[index],controller.signal);}
          catch(error){check(controller.signal);console.warn('Manual preview cache:',error);}
        }
      }catch(error){if(error.name!=='AbortError')console.warn('Manual preview cache:',error);}
      finally{running=false;schedule();}
    }
    return {
      render:load,
      trackGame(id,paths){if(!disposed)games.set(id,[...paths]);},
      showGamePreview(id,{path,signal,onPreview}={}) {
        if(disposed||signal?.aborted)return null;
        const paths=games.get(id);if(!paths?.length)return null;
        const selected=paths.includes(path)?path:paths[0];
        showKnown(selected,validMode(getCoverMode(selected)),signal||controller.signal,onPreview);
        return selected;
      },
      warm(ids) {
        if(!disk||disposed)return;
        for(const id of ids)if(!seen.has(id)){seen.add(id);queued.push(id);}
        schedule(delay);
      },
      refresh(id){seen.delete(id);this.warm([id]);},
      pauseForScroll(){scrolling=true;clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{scrolling=false;schedule();},150);},
      dispose(){disposed=true;controller.abort();clearTimeout(timer);clearTimeout(scrollTimer);queued.length=0;},
    };
  }
  globalThis.OpenCabinetManualCovers={create};
})();
