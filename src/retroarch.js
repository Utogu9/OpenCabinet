(function (root) {
  const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const aliases = [
    [['nes','nintendones','famicom','nintendofamicomdisksystem'], 'Nintendo - Nintendo Entertainment System'],
    [['snes','nintendosnes','supernintendo','superfamicom','sfc'], 'Nintendo - Super Nintendo Entertainment System'],
    [['n64','nintendo64'], 'Nintendo - Nintendo 64'],
    [['gb','gameboy'], 'Nintendo - Game Boy'], [['gbc','gameboycolor'], "Nintendo - Game Boy Color"],
    [['gba','gameboyadvance'], 'Nintendo - Game Boy Advance'], [['nds','ds','nintendods'], 'Nintendo - Nintendo DS'],
    [['3ds','nintendo3ds'], 'Nintendo - Nintendo 3DS'], [['gamecube','gc','ngc'], 'Nintendo - GameCube'], [['wii'], 'Nintendo - Wii'],
    [['psx','ps1','ps','playstation','sonyplaystation'], 'Sony - PlayStation'],
    [['ps2','playstation2','sonyplaystation2'], 'Sony - PlayStation 2'],
    [['psp','playstationportable','sonypsp'], 'Sony - PlayStation Portable'],
    [['megadrive','genesis','segagenesis','segamegadrive','md'], 'Sega - Mega Drive - Genesis'],
    [['mastersystem','sms','segamastersystem'], 'Sega - Master System - Mark III'],
    [['gamegear','segagamegear','gg'], 'Sega - Game Gear'], [['segacd','megacd'], 'Sega - Mega-CD - Sega CD'],
    [['32x','sega32x'], 'Sega - 32X'], [['saturn','segasaturn'], 'Sega - Saturn'], [['dreamcast','segadreamcast','dc'], 'Sega - Dreamcast'],
    [['pcengine','turbografx16','tg16'], 'NEC - PC Engine - TurboGrafx 16'],
    [['atari2600','2600'], 'Atari - 2600'], [['atari7800','7800'], 'Atari - 7800'], [['lynx','atarilynx'], 'Atari - Lynx'],
    [['neogeo','snkneogeo','arcade','mame'], 'Arcade'],
    [['neogeopocket','snkneogeopocket'], "SNK - Neo Geo Pocket / Color"],
    [['wonderswan','bandaiwonderswan'], "Bandai - WonderSwan/Color"],
    [['pcenginecd','necpcenginecd'], 'NEC - PC Engine CD - TurboGrafx-CD'],
    [['3do','3dointeractivemultiplayer','panasonic3do'], 'The 3DO Company - 3DO'],
  ];
  const preferred = [
    ['Nintendo - Nintendo Entertainment System', ['mesen_libretro','nestopia_libretro','fceumm_libretro']],
    ['Nintendo - Super Nintendo Entertainment System', ['snes9x_libretro','bsnes_libretro']],
    ['Nintendo - Game Boy', ['gambatte_libretro','sameboy_libretro']],
    ["Nintendo - Game Boy Color", ['gambatte_libretro','sameboy_libretro']],
    ['Nintendo - Game Boy Advance', ['mgba_libretro']],
    ['Nintendo - Nintendo 64', ['mupen64plus_next_libretro']],
    ['Nintendo - Nintendo DS', ['melondsds_libretro','melonds_libretro']],
    ['Sony - PlayStation', ['swanstation_libretro','mednafen_psx_hw_libretro','pcsx_rearmed_libretro']],
    ['Sony - PlayStation 2', ['pcsx2_libretro','lrps2_libretro']],
    ['Sony - PlayStation Portable', ['ppsspp_libretro']],
    ['Sega - Mega Drive - Genesis', ['genesis_plus_gx_libretro','picodrive_libretro']],
    ['Sega - Master System - Mark III', ['genesis_plus_gx_libretro']],
    ['Sega - Game Gear', ['genesis_plus_gx_libretro']],
    ['Sega - Dreamcast', ['flycast_libretro']], ['Arcade', ['fbneo_libretro','mame_libretro']],
  ];
  function matchSystem(platform, systems) {
    const local = normalize(platform);
    const canonical = aliases.find(([names, name]) => names.includes(local) || normalize(name) === local)?.[1] || platform;
    return systems.find(system => normalize(system) === normalize(canonical)) || systems.find(system => normalize(system) === local) || '';
  }
  function rankedCores(cores, system) {
    const order = preferred.find(([name]) => normalize(name) === normalize(system))?.[1] || [];
    return cores.filter(core => !system || core.systems.includes(system)).map(core => ({ ...core, recommended: order.includes(core.id) }))
      .sort((a,b) => Number(b.recommended)-Number(a.recommended) || (a.recommended ? order.indexOf(a.id)-order.indexOf(b.id) : 0) || a.name.localeCompare(b.name));
  }
  function create({ document, invoke, Channel, onBusy = () => {}, onTask = () => {}, onIdentityChanged = () => {}, elementIds = {}, getPlatform, extraControls = [] }) {
    const get = id => elementIds[id] === null ? null : document.getElementById(elementIds[id] || id);
    const type=get('emu-type'), path=get('emu-path'), name=get('emu-name'), platform=get('emu-platform');
    const panel=get('retroarch-options'), system=get('ra-system'), select=get('ra-core'), message=get('ra-status');
    const install=get('btn-install-retroarch'), refresh=get('btn-refresh-ra-cores'), progress=get('ra-progress'), cancel=get('btn-cancel-ra');
    const platformName = getPlatform || (() => platform.value);
    let cores=[], session=0, operation=null, rememberedPath='', desiredCore='', catalogPath=null, busy=false;
    let previousDisabled = [], lastPlatform = platformName();
    const isRetroArch = () => type.value === 'retroarch';
    const option = (value, label) => { const item=document.createElement('option'); item.value=value; item.textContent=label; return item; };
    function controls(value) {
      busy=value;
      if (value) {
        previousDisabled = [...new Set([type,path,name,platform,system,select,install,refresh,get('btn-browse-emu'),get('emu-args'),get('btn-save-emu'),get('btn-cancel-edit-emu'),get('btn-close-modal'),...extraControls])]
          .filter(Boolean).map(item => [item,item.disabled]);
        previousDisabled.forEach(([item]) => { item.disabled=true; });
      } else {
        previousDisabled.forEach(([item,disabled]) => { item.disabled=disabled; });
        previousDisabled=[];
      }
      cancel.classList.toggle('hidden', !operation); cancel.disabled=false;
      onBusy(value);
    }
    async function run(command, args={}) {
      if (busy) throw new Error(globalThis.OpenCabinetI18n.t("msg.31c416d30d"));
      const currentSession=session;
      const token=globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      operation=token; controls(true); progress.classList.remove('hidden'); progress.removeAttribute('value');
      const label = { install_retroarch:globalThis.OpenCabinetI18n.t("msg.e0b2671711"), get_retroarch_cores:globalThis.OpenCabinetI18n.t("msg.9cde378300"), install_retroarch_core:globalThis.OpenCabinetI18n.t("msg.a1520ca285") }[command];
      onTask({type:'start',operationId:token,label,cancel:()=>cancelOperation(token)});
      const channel=new Channel();
      channel.onmessage=data => {
        if (operation!==token || currentSession!==session || data.operation_id!==token) return;
        message.textContent=data.phase;
        if (data.total) progress.value=Math.round(data.processed/data.total*100); else progress.removeAttribute('value');
        onTask({type:'progress',operationId:token,progress:data});
      };
      let failure=null;
      try {
        const result=await invoke(command, {...args, operationId:token, onProgress:channel});
        if (session!==currentSession) throw new Error(globalThis.OpenCabinetI18n.t("msg.aba9f3a5d3"));
        return result;
      } catch (error) {
        failure=error; throw error;
      } finally {
        if (operation===token) { operation=null; controls(false); progress.classList.add('hidden'); onTask({type:'end',operationId:token,error:failure}); }
      }
    }
    function describe() {
      const core=cores.find(core=>core.id===select.value);
      get('ra-core-description').textContent=core?.description || '';
      get('ra-firmware').textContent=core?.firmware?.length ? globalThis.OpenCabinetI18n.t("msg.422a7ea94a", core.firmware.join('; ')) : '';
      if (core) message.textContent=core.installed ? globalThis.OpenCabinetI18n.t("msg.28f13fba36") : globalThis.OpenCabinetI18n.t("msg.6fa90387dd");
      if (core && (!name.value.trim() || name.value.trim()==='RetroArch' || name.value.startsWith('RetroArch ('))) name.value=`RetroArch (${core.name})`;
    }
    function renderCores(keep='') {
      const list=rankedCores(cores, system.value);
      select.replaceChildren(option('', list.length ? globalThis.OpenCabinetI18n.t("msg.c097bf03d8") : globalThis.OpenCabinetI18n.t("msg.b1d9a4d87c")));
      list.forEach(core=>select.appendChild(option(core.id, `${core.recommended?globalThis.OpenCabinetI18n.t("msg.649d9cd4e9"):''}${core.name}${core.installed?globalThis.OpenCabinetI18n.t("msg.657be21ed5"):''}`)));
      const preserved=list.find(core=>core.id===keep);
      select.value=preserved?.id || list.find(core=>core.recommended)?.id || '';
      describe();
    }
    function renderSystems() {
      const systems=[...new Set(cores.flatMap(core=>core.systems))].sort((a,b)=>a.localeCompare(b));
      const match=matchSystem(platformName(), systems);
      const selected=cores.find(core=>core.id===desiredCore);
      system.replaceChildren(option('', globalThis.OpenCabinetI18n.t("msg.42146e29a5")));
      systems.forEach(item=>system.appendChild(option(item,item)));
      system.value=match || selected?.systems[0] || '';
      renderCores(desiredCore);
      if (!match && !selected && platformName()) message.textContent=globalThis.OpenCabinetI18n.t("msg.c44bdacb8f");
    }
    async function load(refreshCatalog=false) {
      if (!isRetroArch() || busy) return;
      const currentPath=path.value.trim(), currentSession=session;
      const keep=select.value || desiredCore;
      try {
        const result=await run('get_retroarch_cores', {executablePath:currentPath || null, refresh:refreshCatalog});
        if (currentSession!==session) return;
        cores=result; catalogPath=currentPath; desiredCore=keep; renderSystems();
      } catch (error) { if (currentSession===session) message.textContent=globalThis.OpenCabinetI18n.t("msg.a2328fa947", error); }
    }
    async function activate() {
      panel.classList.toggle('hidden', !isRetroArch());
      if (!isRetroArch()) return;
      if (!name.value.trim() || name.value===`${platformName()} Emulator`) name.value='RetroArch';
      const currentSession=session;
      if (!path.value.trim()) {
        try { const status=await invoke('get_retroarch_status'); if (currentSession!==session || !isRetroArch()) return; rememberedPath=status.executable_path || ''; if (!path.value.trim()) path.value=rememberedPath; }
        catch (error) { message.textContent=globalThis.OpenCabinetI18n.t("msg.0d609aa592", error); }
      }
      if (currentSession===session && isRetroArch()) { onIdentityChanged(); await load(); }
    }
    async function cancelOperation(token) {
      if (!token || operation!==token) return;
      cancel.disabled=true; message.textContent=globalThis.OpenCabinetI18n.t("msg.c5b0af9a5e");
      onTask({type:'cancelling',operationId:token});
      try { await invoke('cancel_retroarch_operation', {operationId:token}); }
      catch (error) {
        if (operation!==token) return;
        message.textContent=globalThis.OpenCabinetI18n.t("msg.0afb96bdd7", error); cancel.disabled=false;
        onTask({type:'cancel-error',operationId:token,error});
      }
    }
    cancel.addEventListener('click', () => cancelOperation(operation));
    type.addEventListener('change', activate);
    path.addEventListener('change', () => { if (catalogPath!==path.value.trim()) load(); });
    // The existing file browser dispatches input after selecting an executable.
    path.addEventListener('input', () => { catalogPath=null; });
    path.addEventListener('blur', () => { if (catalogPath!==path.value.trim()) load(); });
    function platformChanged() {
      if (lastPlatform===platformName()) return;
      lastPlatform=platformName(); desiredCore=''; select.value='';
      if (isRetroArch()) renderSystems();
    }
    platform.addEventListener('change', platformChanged);
    system.addEventListener('change', () => { desiredCore=''; renderCores(); });
    select.addEventListener('change', () => { desiredCore=select.value; describe(); });
    refresh.addEventListener('click', () => load(true));
    install.addEventListener('click', async () => {
      if (busy) return;
      try { path.value=await run('install_retroarch'); rememberedPath=path.value; onIdentityChanged(); message.textContent=globalThis.OpenCabinetI18n.t("msg.149640a35a"); await load(); }
      catch (error) { message.textContent=globalThis.OpenCabinetI18n.t("msg.3d388640a7", error); }
    });
    return {
      get busy() { return busy; },
      platformChanged,
      reset() {
        if (busy) return;
        session++; desiredCore=''; type.value='standalone'; panel.classList.add('hidden');
        message.textContent=''; get('ra-core-description').textContent=''; get('ra-firmware').textContent='';
      },
      edit(emulator) {
        if (busy) return;
        session++; desiredCore=emulator.retroarch_core_path?.replace(/\\/g,'/').split('/').pop()?.replace(/\.(dll|so)$/i,'') || '';
        type.value=emulator.retroarch_core_path?'retroarch':'standalone';
        activate();
      },
      async prepare() {
        if (!isRetroArch()) return null;
        if (busy) throw new Error(globalThis.OpenCabinetI18n.t("msg.31c416d30d"));
        if (!path.value.trim()) throw new Error(globalThis.OpenCabinetI18n.t("msg.9f58a4befd"));
        if (catalogPath!==path.value.trim()) { await load(); }
        const core=cores.find(core=>core.id===select.value);
        if (!core) throw new Error(globalThis.OpenCabinetI18n.t("msg.8fabf63aa5"));
        try {
          // Backend validates even already-installed cores and their PE architecture.
          const corePath=await run('install_retroarch_core', {executablePath:path.value.trim(), coreId:core.id});
          core.installed=true; core.path=corePath;
          return corePath;
        } catch (error) { message.textContent=String(error); throw error; }
      },
    };
  }
  const api={normalize,matchSystem,rankedCores,create};
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.OpenCabinetRetroArch=api;
})(typeof window==='object'?window:globalThis);
