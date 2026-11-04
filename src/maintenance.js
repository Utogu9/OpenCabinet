(() => {
  const recent=[];
  function sanitize(value) {
    return String(value).slice(0,2000)
      .replace(/https?:\/\/[^\s"'<>]+/gi,'[URL]')
      .replace(/[a-z]:[\\/][^\n"'<>]*/gi,'[local path]')
      .replace(/\/(?:home|Users|mnt|media|run|tmp)\/[^\n"'<>]*/g,'[local path]')
      .replace(/\b(password|passwd|token|api[_-]?key|authorization)\s*[:=]\s*\S+/gi,'$1=[redacted]');
  }
  function record(value,source='error') {
    recent.push({time:new Date().toISOString(),source,message:sanitize(value instanceof Error?value.message:value)});
    if(recent.length>50)recent.shift();
  }
  const original=console.error;
  console.error=function(...args) { record(args.map(v=>v instanceof Error?v.message:typeof v==='string'?v:'[object]').join(' '),'console'); original.apply(console,args); };
  globalThis.addEventListener?.('error',event=>record(event.message,'window'));
  globalThis.addEventListener?.('unhandledrejection',event=>record(event.reason,'promise'));

  const t=(key,...args)=>globalThis.OpenCabinetI18n.t(key,...args);
  const size=bytes=> {
    const n=Number(bytes)||0; const units=['B','KiB','MiB','GiB','TiB'];
    const level=n?Math.min(4,Math.floor(Math.log(n)/Math.log(1024))):0;
    return `${(n/1024**level).toLocaleString(globalThis.OpenCabinetI18n.locale,{maximumFractionDigits:1})} ${units[level]}`;
  };
  function setup({document,invoke,getPreferences,onBusyChange=()=>{}}) {
    const get=id=>document.getElementById(id);
    let busy=false,calculating=false,request=0;
    function controls() { for(const id of ['btn-refresh-storage','btn-clear-cache'])get(id).disabled=busy||calculating; }
    function row(label,value) {
      const div=document.createElement('div'),name=document.createElement('span'),amount=document.createElement('strong');
      div.className='storage-usage-row';name.textContent=label;amount.textContent=value;div.append(name,amount);return div;
    }
    async function refresh() {
      if(calculating)return;
      const current=++request;calculating=true;controls();get('storage-status').textContent=t('maintenance.scanning');
      try {
        const data=await invoke('get_storage_usage',{cacheDirectory:getPreferences().cacheDirectory||null});
        if(current!==request)return;
        const rows=get('storage-sections');rows.replaceChildren();let total=0;
        for(const [key,usage] of Object.entries(data.sections)) { total+=usage.bytes;rows.append(row(t(`maintenance.section.${key}`),size(usage.bytes))); }
        rows.append(row(t('maintenance.total'),size(total)));
        get('storage-location').textContent=data.directory;
        get('storage-cache-location').textContent=t('maintenance.cache_location',data.cache_directory);
        const retained=get('storage-retained');retained.replaceChildren();
        for(const item of data.retained) {
          const entry=row(`${item.title} · ${item.platform}`,size(item.usage.bytes));
          const open=document.createElement('button');open.type='button';open.className='secondary-btn';open.textContent=t('maintenance.open_folder');
          open.addEventListener('click',()=>invoke('open_retained_collection',{id:item.id}).catch(e=>{get('storage-status').textContent=String(e);}));
          entry.append(open);retained.append(entry);
        }
        get('storage-retained-count').textContent=t('maintenance.retained_count',data.retained.length);
        get('storage-status').textContent=data.skipped?t('maintenance.skipped',data.skipped):'';
      } catch(e) {get('storage-status').textContent=String(e);}
      finally {if(current===request){calculating=false;controls();}}
    }
    get('btn-refresh-storage').addEventListener('click',refresh);
    get('btn-clear-cache').addEventListener('click',async()=> {
      if(busy||calculating||get('storage-clear-confirm').open)return;
      const confirm=get('storage-clear-confirm');
      const accepted=await new Promise(resolve=>{confirm.returnValue='cancel';confirm.addEventListener('close',()=>resolve(confirm.returnValue==='clear'),{once:true});confirm.showModal();});
      if(!accepted||busy)return;
      busy=true;controls();onBusyChange();get('storage-status').textContent=t('maintenance.cleaning');
      try {
        const deleted=await invoke('clear_thumbnail_cache',{cacheDirectory:getPreferences().cacheDirectory||null});
        get('storage-status').textContent=t('maintenance.cleaned',deleted.files,size(deleted.bytes))+' '+t('maintenance.stale')+(deleted.skipped?' '+t('maintenance.skipped',deleted.skipped):'');
      } catch(e) {get('storage-status').textContent=String(e);}
      finally {busy=false;controls();onBusyChange();}
    });
    get('btn-diagnostics').addEventListener('click',async()=> {
      const button=get('btn-diagnostics');button.disabled=true;
      try {
        const system=await invoke('diagnostic_system');let graphics={available:false};
        try {
          const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl');
          if(gl) {
            const info=gl.getExtension('WEBGL_debug_renderer_info');
            graphics={available:true,version:gl.getParameter(gl.VERSION),renderer:gl.getParameter(info?.UNMASKED_RENDERER_WEBGL||gl.RENDERER),vendor:gl.getParameter(info?.UNMASKED_VENDOR_WEBGL||gl.VENDOR),max_texture_size:gl.getParameter(gl.MAX_TEXTURE_SIZE)};
            gl.getExtension('WEBGL_lose_context')?.loseContext();
          }
        } catch(_) { /* Report an unavailable context without interrupting export. */ }
        const preferences=getPreferences();
        const report={format:'opencabinet-diagnostics-v1',created_at:new Date().toISOString(),system,webview_user_agent:navigator.userAgent,
          display:{width:globalThis.innerWidth,height:globalThis.innerHeight,pixel_ratio:globalThis.devicePixelRatio},graphics,
          preferences:{language:preferences.language,cache_mode:preferences.cacheMode,ram_cover_limit:preferences.maxCachedCovers},recent_errors:recent.slice()};
        get('diagnostic-preview').value=JSON.stringify(report,null,2);get('diagnostic-status').textContent='';get('diagnostic-dialog').showModal();
      } catch(e) { record(e);get('diagnostic-preview').value=String(e);get('diagnostic-dialog').showModal(); }
      finally {button.disabled=false;}
    });
    get('btn-export-diagnostics').addEventListener('click',async()=> {
      const button=get('btn-export-diagnostics');button.disabled=true;
      try {const saved=await invoke('export_diagnostic_report',{report:get('diagnostic-preview').value});get('diagnostic-status').textContent=saved?t('maintenance.exported'):'';}
      catch(e){get('diagnostic-status').textContent=String(e);}
      finally {button.disabled=false;}
    });
    get('btn-close-diagnostics').addEventListener('click',()=>get('diagnostic-dialog').close());
    return {open:controls,get busy(){return busy;}};
  }
  globalThis.OpenCabinetMaintenance={setup,record,sanitize,size};
})();
