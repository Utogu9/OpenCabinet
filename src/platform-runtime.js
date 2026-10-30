// Host-specific UI and optional Linux launch settings. File paths are never title keys.
(() => {
  const t=(key,...args)=>globalThis.OpenCabinetI18n.t(key,...args);
  const api={capabilities:{os:'windows',arch:'x86_64',epic:true,wine:false,proton:false},
    get linux(){return this.capabilities.os==='linux';},
    pathKey(path){return this.linux?String(path):String(path).replace(/\\/g,'/').toLowerCase();},
    async initialize(invoke,document){
      api.capabilities=await invoke('get_runtime_capabilities');
      document.documentElement.dataset.os=api.capabilities.os;
      if(!api.capabilities.epic){const epic=document.getElementById('btn-import-epic');if(epic){epic.hidden=true;epic.classList.add('hidden');}}
      if(api.linux){
        const labels={
          'msg.5faeee358d':'linux.executablePath','msg.d645d98859':'linux.executableExample',
          'msg.215b9a8198':'linux.gameExecutable','msg.5af9fe9b5e':'linux.chooseGame',
          'msg.3ba4c8d8b2':'linux.directHelp','msg.9f58a4befd':'linux.chooseRetroarch',
          'msg.39321f7c10':'linux.steamFolder','msg.e308ec7fe0':'linux.steamFolder',
        };
        for(const attribute of ['data-i18n','data-i18n-placeholder'])for(const element of document.querySelectorAll(`[${attribute}]`)){
          const replacement=labels[element.getAttribute(attribute)];if(replacement)element.setAttribute(attribute,replacement);
        }
      }
    },
    createEditor(host,{invoke,document,prefix}){
      if(!api.linux||!host)return null;
      const section=document.createElement('section');section.className='linux-launch-options';
      const heading=document.createElement('h3');heading.textContent=t('linux.execution');section.append(heading);
      const mode=document.createElement('select');mode.id=`${prefix}-linux-mode`;
      for(const [value,key]of [['native','linux.native'],['wine','linux.wine'],['proton','linux.proton']]){const option=document.createElement('option');option.value=value;option.textContent=t(key);mode.append(option);}
      const group=(label,control)=>{const div=document.createElement('div');div.className='form-group';const caption=document.createElement('label');caption.htmlFor=control.id;caption.textContent=t(label);div.append(caption,control);section.append(div);return div;};
      group('linux.launchWith',mode);
      function pathField(name,label,directory){
        const input=document.createElement('input');input.type='text';input.id=`${prefix}-linux-${name}`;input.autocomplete='off';
        const wrap=document.createElement('div');wrap.className='folder-input-wrapper';
        const browse=document.createElement('button');browse.type='button';browse.className='browse-btn';browse.textContent=t('linux.browse');
        browse.addEventListener('click',async()=>{try{const picked=await invoke('choose_runtime_path',{directory});if(picked)input.value=picked;}catch(error){status.textContent=String(error);}});
        wrap.append(input,browse);const outer=group(label,wrap);outer.querySelector('label').htmlFor=input.id;
        return {input,outer};
      }
      const runner=pathField('runner','linux.runner',false),proton=pathField('proton','linux.protonDirectory',true),umu=pathField('umu','linux.umuExecutable',false);
      const wineList=document.createElement('datalist'),protonList=document.createElement('datalist');wineList.id=`${prefix}-wine-list`;protonList.id=`${prefix}-proton-list`;
      runner.input.setAttribute('list',wineList.id);proton.input.setAttribute('list',protonList.id);section.append(wineList,protonList);
      const winePrefix=pathField('prefix','linux.prefix',true),directory=pathField('directory','linux.workingDirectory',true);
      winePrefix.input.placeholder=t('linux.automaticPrefix');directory.input.placeholder=t('linux.gameDirectory');
      const help=document.createElement('p');help.className='help-text';help.textContent=t('linux.umuHelp');section.append(help);
      const status=document.createElement('p');status.className='help-text';status.setAttribute('role','status');section.append(status);
      host.append(section);let touched=false,runners={wine:[],proton:[],umu:null},request=null;
      const nullable=input=>input.value.trim()||null;
      function sync(){runner.outer.classList.toggle('hidden',mode.value!=='wine');proton.outer.classList.toggle('hidden',mode.value!=='proton');umu.outer.classList.toggle('hidden',mode.value!=='proton');winePrefix.outer.classList.toggle('hidden',mode.value==='native');help.classList.toggle('hidden',mode.value!=='proton');}
      mode.addEventListener('change',()=>{touched=true;sync();});
      function defaults(){if(!runner.input.value)runner.input.value=runners.wine[0]||'';if(!proton.input.value)proton.input.value=runners.proton[0]||'';if(!umu.input.value)umu.input.value=runners.umu||'';}
      async function load(){
        request ||= invoke('get_linux_runners').then(result=>{
          runners=result;
          for(const [list,values]of [[wineList,result.wine],[protonList,result.proton]]){list.replaceChildren();for(const path of values){const option=document.createElement('option');option.value=path;list.append(option);}}
          defaults();
        }).catch(error=>{request=null;status.textContent=String(error);});return request;
      }
      sync();
      return {
        set(options=null,path=''){
          touched=!!options;mode.value=options?.mode||(/\.exe$/i.test(path)?'wine':'native');
          runner.input.value=options?.mode==='wine'?options.runner_path||'':'';proton.input.value=options?.mode==='proton'?options.runner_path||'':'';
          umu.input.value=options?.umu_path||'';winePrefix.input.value=options?.prefix||'';directory.input.value=options?.working_directory||'';status.textContent='';defaults();sync();void load();
        },
        value(path=''){
          const selected=!touched?(/\.exe$/i.test(path)?'wine':'native'):mode.value;
          if(selected==='wine'&&!nullable(runner.input))throw new Error(t('linux.wineMissing'));
          if(selected==='proton'&&!nullable(proton.input))throw new Error(t('linux.protonMissing'));
          return {mode:selected,runner_path:selected==='wine'?nullable(runner.input):selected==='proton'?nullable(proton.input):null,umu_path:selected==='proton'?nullable(umu.input):null,prefix:selected==='native'?null:nullable(winePrefix.input),working_directory:nullable(directory.input)};
        },
        show(visible){host.classList.toggle('hidden',!visible);if(visible)void load();},
        forPath(path){if(!touched){mode.value=/\.exe$/i.test(path)?'wine':'native';sync();}},
      };
    },
  };
  globalThis.OpenCabinetRuntime=api;
})();
