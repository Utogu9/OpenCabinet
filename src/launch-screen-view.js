(() => {
  const {invoke,convertFileSrc}=window.__TAURI__.core;
  let current=null;
  function image(id,path) {
    const node=document.getElementById(id);
    node.onload=node.onerror=null;node.hidden=true;node.removeAttribute('src');node.classList.remove('loaded');
    if(!path)return;
    node.onload=()=>{node.hidden=false;node.classList.add('loaded');};
    node.onerror=()=>{node.hidden=true;};
    node.src=convertFileSrc(path);
  }
  async function render() {
    const state=await invoke('launch_screen_presentation');
    if(!state||state.id===current)return;
    current=state.id;
    const data=state.presentation;
    document.documentElement.style.backgroundColor=data.color;
    document.getElementById('loading').textContent=data.loading;
    document.getElementById('dismiss').textContent=data.dismiss;
    document.getElementById('title').textContent=data.title;
    image('background',data.settings.useBackground?data.background:null);
    image('logo',data.logo);image('media',data.media);
    document.getElementById('media').classList.toggle('spinning',data.spinning);
    // The window starts hidden: requestAnimationFrame can be suspended there.
    // Show once its fallback DOM is ready, without waiting on artwork decoding.
    void invoke('launch_screen_rendered',{id:state.id}).catch(console.error);
  }
  const dismiss=()=>current==null?undefined:invoke('dismiss_launch_screen',{id:current}).catch(console.error);
  document.getElementById('dismiss').addEventListener('click',dismiss);
  window.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();void dismiss();}});
  window.__TAURI__.event.listen('launch-screen-changed',()=>void render().catch(console.error))
    .then(()=>render()).catch(console.error);
})();
