(() => {
  const t=(key,...args)=>globalThis.OpenCabinetI18n.t(key,...args);
  function create({host,document,invoke,confirm,onChanged,canSwitch,onBusyChange}) {
    let data=null,busy=false;
    const list=document.createElement('div');list.className='user-profile-list';
    const add=document.createElement('div');add.className='user-profile-row';
    const input=document.createElement('input');input.type='text';input.maxLength=80;input.placeholder=t('profiles.name');input.setAttribute('aria-label',t('profiles.name'));
    const create=document.createElement('button');create.type='button';create.className='browse-btn';create.textContent=t('profiles.create');
    const status=document.createElement('p');status.className='help-text';status.setAttribute('role','status');
    add.append(input,create);host.append(list,add,status);
    async function task(action){if(busy)return;busy=true;onBusyChange?.();render();status.textContent='';
      try{data=await action();}catch(error){status.textContent=String(error);}finally{busy=false;render();onBusyChange?.();}}
    function button(label,action,icon){const node=document.createElement('button');node.type='button';node.className='browse-btn';node.disabled=busy;
      if(icon)globalThis.OpenCabinetIcons.label(node,label,icon);else node.textContent=label;
      node.addEventListener('click',action);return node;}
    function render(){list.replaceChildren();input.disabled=create.disabled=busy;
      const activeName=data?.profiles.find(profile=>profile.id===data.active)?.name;
      if(activeName)document.getElementById('active-user-profile').textContent=' · '+activeName;
      for(const profile of data?.profiles||[]){
        const row=document.createElement('div');row.className='user-profile-row';
        const name=document.createElement('input');name.value=profile.name;name.maxLength=80;name.disabled=busy;name.setAttribute('aria-label',t('profiles.name'));
        const active=profile.id===data.active;
        const activate=button(t(active?'profiles.active':'profiles.switch'),()=>void task(async()=>{
          if(!canSwitch())throw Error(t('profiles.busy'));
          const result=await invoke('switch_user_profile',{id:profile.id});data=result;await onChanged(result);return result;
        }));activate.disabled=busy||active;
        const rename=button(t('profiles.rename'),()=>void task(()=>invoke('save_user_profile',{id:profile.id,name:name.value})), 'pencil');
        name.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();rename.click();}});
        const remove=button(t('profiles.delete'),()=>void task(async()=>{
          if(!await confirm(t('profiles.delete'),t('profiles.deleteWarning',profile.name)))return data;
          return invoke('delete_user_profile',{id:profile.id});
        }),'trash-2');remove.disabled=busy||active||profile.id===1;
        row.append(name,activate,rename,remove);list.append(row);
      }
    }
    create.addEventListener('click',()=>void task(async()=>{const result=await invoke('save_user_profile',{name:input.value});input.value='';return result;}));
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();create.click();}});
    return {get busy(){return busy;},open:()=>task(()=>invoke('get_user_profiles'))};
  }
  globalThis.OpenCabinetProfiles={create};
})();
