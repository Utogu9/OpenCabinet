// Present archive images through the same page interface used by the PDF reader.
// Rust reads one ZIP entry at a time; decoded images are released after drawing.
(() => {
  const error=key=>new Error(globalThis.OpenCabinetI18n.t(key));
  const cancelled=()=>new DOMException(globalThis.OpenCabinetI18n.t('msg.92a2872d72'),'AbortError');
  function library(path,{invoke=(command,args)=>globalThis.__TAURI__.core.invoke(command,args),decode=bytes=>createImageBitmap(new Blob([new Uint8Array(bytes)]))}={}){
    return {getDocument(){
      let destroyed=false;const bitmaps=new Set();
      const check=()=>{if(destroyed)throw cancelled();};
      return {
        async destroy(){destroyed=true;bitmaps.forEach(bitmap=>bitmap.close());bitmaps.clear();},
        promise:(async()=>{
          const manifest=await invoke('get_cbz_manifest',{path});check();
          if(!manifest?.pages?.length||typeof manifest.fingerprint!=='string')throw error('cbz.empty');
          return {
            numPages:manifest.pages.length,
            async getPage(number){
              check();const page=manifest.pages[number-1];if(!Number.isInteger(number)||!page)throw error('cbz.invalidPage');
              const bytes=await invoke('read_cbz_page',{path,index:page.index,fingerprint:manifest.fingerprint});check();
              let bitmap;
              try{bitmap=await decode(bytes);check();}
              catch(reason){bitmap?.close();throw destroyed?cancelled():reason;}
              if(!bitmap.width||!bitmap.height){bitmap.close();throw error('cbz.invalidPage');}
              bitmaps.add(bitmap);const width=bitmap.width,height=bitmap.height;
              return {
                getViewport:({scale})=>({width:width*scale,height:height*scale}),
                cleanup(){if(bitmaps.delete(bitmap))bitmap.close();},
                render({canvasContext:context,viewport,background,transform}){
                  let aborted=false;
                  return {cancel(){aborted=true;},promise:Promise.resolve().then(()=>{
                    check();if(aborted)throw cancelled();if(!bitmaps.has(bitmap))throw error('cbz.invalidPage');
                    context.save();
                    try{
                      context.fillStyle=background||'#ffffff';context.fillRect(0,0,context.canvas.width,context.canvas.height);
                      if(transform)context.transform(...transform);
                      context.drawImage(bitmap,0,0,viewport.width,viewport.height);
                    }finally{context.restore();}
                  })};
                },
              };
            },
          };
        })(),
      };
    }};
  }
  globalThis.OpenCabinetManualCBZ={library};
})();
