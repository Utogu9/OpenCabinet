(() => {
  function setup({ document, invoke, Channel, getPreferences, canRestart, onBusyChange = () => {}, onRestored = async () => {} }) {
    const get=id=>document.getElementById(id), t=(key,...args)=>globalThis.OpenCabinetI18n.t(key,...args);
    const status=get('backups-status'),list=get('backup-list');
    let busy=false, loaded=false;
    function controls() {
      for(const id of ['backup-automatic','backup-keep','backup-full','btn-save-backup-settings','btn-create-backup','btn-restore-backup','btn-choose-backup','btn-open-backup-directory'])get(id).disabled=busy||!loaded;
      get('btn-restore-backup').disabled=busy||!loaded||!list.value;
      list.disabled=busy||!loaded;
    }
    async function refresh() {
      const data=await invoke('get_backup_status');loaded=true;
      get('backup-automatic').checked=data.settings.automatic;get('backup-keep').value=String(data.settings.keep);
      get('backup-directory').textContent=data.directory;list.replaceChildren();
      for(const entry of data.entries) {
        const option=document.createElement('option');option.value=entry.name;
        option.textContent=`${new Date(entry.created*1000).toLocaleString(globalThis.OpenCabinetI18n.locale)} · ${t(entry.full?'backup.full':'backup.light')} · ${t(entry.automatic?'backup.automatic':'backup.manual')} · ${(entry.bytes/1048576).toFixed(1)} MB`;
        list.appendChild(option);
      }
      if(data.error)status.textContent=data.error;
      controls();return data;
    }
    async function run(action) {
      if(busy||!loaded)return;
      busy=true;controls();status.textContent=t('backup.working');
      onBusyChange();
      try { await action(); } catch(error){status.textContent=String(error);}
      finally {busy=false;controls();onBusyChange();}
    }
    function progress() {
      const channel=new Channel();channel.onmessage=p=>{if(busy)status.textContent=t('backup.progress',p.files,(p.bytes/1048576).toFixed(1));};return channel;
    }
    async function restore(path) {
      const confirm=get('backup-restore-confirm');
      const accepted=await new Promise(resolve=>{
        confirm.returnValue='cancel';confirm.addEventListener('close',()=>resolve(confirm.returnValue==='restore'),{once:true});confirm.showModal();
      });
      if(!accepted){status.textContent='';return;}
      await invoke('save_backup_preferences',{preferences:getPreferences()});
      const destination=await invoke('restore_backup',{path,onProgress:progress()});
      await onRestored();
      status.textContent=t('backup.restored',destination);
      get('btn-backup-restart').classList.remove('hidden');
    }
    async function open() {
      if(busy)return;loaded=false;status.textContent='';controls();
      try{await refresh();}catch(error){status.textContent=String(error);}
    }
    const saveSettings = ()=>run(async()=>{
      const keep=Number(get('backup-keep').value);if(!Number.isInteger(keep)||keep<1||keep>30)throw new Error(t('backup.keep_invalid'));
      await invoke('save_backup_settings',{settings:{automatic:get('backup-automatic').checked,keep}});status.textContent=t('backup.saved');
    });
    get('btn-save-backup-settings').addEventListener('click',saveSettings);
    get('btn-create-backup').addEventListener('click',()=>run(async()=>{
      await invoke('save_backup_preferences',{preferences:getPreferences()});
      await invoke('create_backup',{full:get('backup-full').checked,onProgress:progress()});
      await refresh();status.textContent=t('backup.created');
    }));
    list.addEventListener('change',controls);
    get('btn-open-backup-directory').addEventListener('click',()=>run(async()=>{await invoke('open_backup_directory');status.textContent='';}));
    get('btn-restore-backup').addEventListener('click',()=>run(async()=>{
      const data=await invoke('get_backup_status');const name=list.value;
      if(!data.entries.some(e=>e.name===name))throw new Error(t('backup.invalid'));
      await restore(`${data.directory.replace(/[\\/]$/,'')}/${name}`);
    }));
    get('btn-choose-backup').addEventListener('click',()=>run(async()=>{const path=await invoke('choose_backup');if(path)await restore(path);else status.textContent='';}));
    get('btn-backup-restart').addEventListener('click',()=>run(async()=>{
      if(!canRestart())throw new Error(t('backup.finish_tasks'));
      await invoke('restart_for_data_move');
    }));
    return { refresh, open, saveSettings, get busy() { return busy; } };
  }
  globalThis.OpenCabinetBackups={setup};
})();
