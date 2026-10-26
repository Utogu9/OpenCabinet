(function (root) {
  const names = { usa:"USA", us:"USA", europe:globalThis.OpenCabinetI18n.t("msg.fc30e2a579"), eur:globalThis.OpenCabinetI18n.t("msg.fc30e2a579"), eu:globalThis.OpenCabinetI18n.t("msg.fc30e2a579"), japan:globalThis.OpenCabinetI18n.t("msg.b69d7b129c"), jap:globalThis.OpenCabinetI18n.t("msg.b69d7b129c"), jp:globalThis.OpenCabinetI18n.t("msg.b69d7b129c"), world:"World", australia:"Australia", asia:"Asia", korea:globalThis.OpenCabinetI18n.t("msg.b31fd8308f"), brazil:globalThis.OpenCabinetI18n.t("msg.6641c5a7ff"), spain:globalThis.OpenCabinetI18n.t("msg.f85c9fe369"), france:globalThis.OpenCabinetI18n.t("msg.6b6251a34b"), germany:globalThis.OpenCabinetI18n.t("msg.7630decd1a"), italy:globalThis.OpenCabinetI18n.t("msg.a7ca3e3d75") };
  function guess(path = "") {
    const filename = path.split(/[\\/]/).pop();
    const labels = [...filename.matchAll(/[([]([^\])]+)[\])]/g)].flatMap(match => match[1].split(/[,/]/)).map(token => names[token.trim().toLowerCase()]).filter(Boolean);
    return [...new Set(labels)].join(" / ");
  }
  function members(game) { return game.regions?.length ? game.regions : [{ label:guess(game.rom_path) || globalThis.OpenCabinetI18n.t("msg.e545b02d8d"), game }]; }
  function selected(game) { return game.regions?.find(region => region.game.id === game.default_region_id)?.game || game; }
  function element(tag, text, cls) { const el=document.createElement(tag); if(text)el.textContent=text;if(cls)el.className=cls;return el; }
  function button(text, action) { const el=element("button",text,"secondary-btn");el.type="button";el.onclick=action;return el; }
  function dialog(title) { const modal=element("dialog",null,"disc-dialog");modal.setAttribute("aria-label",title);modal.append(element("h2",title));document.body.append(modal);return modal; }
  async function chooseRegion(game, invoke) {
    const available = await Promise.all(members(game).map(async region => ({...region,discs:await invoke("get_game_discs",{id:region.game.id})})));
    return new Promise(resolve=>{
      const modal=dialog(globalThis.OpenCabinetI18n.t("msg.a89714ebc3", game.title)), list=element("div",null,"disc-choice-list");let done=false;
      function finish(id){if(done)return;done=true;modal.close();modal.remove();resolve(id);}
      let preferred;
      for(const region of available){
        const isDefault=region.game.id===game.default_region_id;
        const item=button("",()=>finish(region.game.id));item.classList.add("disc-choice");
        item.append(element("strong",`${region.label}${isDefault ? globalThis.OpenCabinetI18n.t("msg.ca29be1250") : ""}`),element("span",region.game.rom_path.split(/[\\/]/).pop()),element("span",`${region.discs.length} ${region.discs.length===1?globalThis.OpenCabinetI18n.t("msg.247a8174ec"):globalThis.OpenCabinetI18n.t("msg.c2ab077beb")}`));
        item.disabled=!region.discs.some(disc=>disc.available);
        if(item.disabled)item.append(element("span",globalThis.OpenCabinetI18n.t("msg.cd62f5eb3a"),"disc-error"));
        list.append(item);if(isDefault&&!item.disabled)preferred=item;
      }
      modal.append(list,button(globalThis.OpenCabinetI18n.t("msg.bb9dbb406d"),()=>finish(null)));
      modal.addEventListener("cancel",event=>{event.preventDefault();finish(null);});
      modal.showModal();preferred?.focus();
    });
  }
  async function mergeGames(games, invoke) {
    const regions=games.flatMap(members).map((region,index)=>({...region,label:region.label||guess(region.game.rom_path)||globalThis.OpenCabinetI18n.t("msg.de6d5b15ed", index+1)}));
    return new Promise(resolve=>{
      const modal=dialog(globalThis.OpenCabinetI18n.t("msg.6cd843ce14"));
      modal.append(element("p",globalThis.OpenCabinetI18n.t("msg.4e06837553"),"help-text"));
      const label=element("label",globalThis.OpenCabinetI18n.t("msg.69c4ac3d9e")),primary=element("select");
      regions.forEach(region=>{const option=element("option",`${region.game.title} · ${region.label}`);option.value=region.game.id;primary.append(option);});
      primary.value=String(games[0].id);label.append(primary);modal.append(label);
      const list=element("div",null,"region-edit-list");
      regions.forEach(region=>{const row=element("label",null,"form-group");row.append(element("span",region.game.rom_path.split(/[\\/]/).pop()));const input=element("input");input.value=region.label;input.maxLength=100;input.autocomplete="off";input.setAttribute("aria-label",globalThis.OpenCabinetI18n.t("msg.33ac393f9d"));input.oninput=()=>{region.label=input.value;};row.append(input);list.append(row);});
      let busy=false,done=false;const error=element("p",null,"disc-error");error.setAttribute("role","alert");
      function finish(id){if(busy||done)return;done=true;modal.close();modal.remove();resolve(id);}
      const cancel=button(globalThis.OpenCabinetI18n.t("msg.bb9dbb406d"),()=>finish(null)),confirm=button(globalThis.OpenCabinetI18n.t("msg.53615300e7"),async()=>{
        if(busy)return;busy=true;error.textContent="";
        const controls=[...modal.querySelectorAll("button,input,select")];controls.forEach(control=>{control.disabled=true;});
        try{const id=Number(primary.value);await invoke("merge_game_regions",{ids:games.map(game=>game.id),primaryId:id,labels:regions.map(region=>({id:region.game.id,label:region.label}))});busy=false;finish(id);}
        catch(reason){busy=false;error.textContent=String(reason);controls.forEach(control=>{control.disabled=false;});}
      });
      const actions=element("div",null,"form-actions");actions.append(cancel,confirm);modal.append(list,error,actions);
      modal.addEventListener("cancel",event=>{event.preventDefault();finish(null);});modal.showModal();
    });
  }
  function createEditor(container, onEdit) {
    let group=null,defaultId=null,labels=[];
    return {
      setGame(game,editingId){
        group=game;defaultId=game.default_region_id;labels=members(game).map(region=>({id:region.game.id,label:region.label}));container.replaceChildren();
        if(!game.regions?.length){container.append(element("p",globalThis.OpenCabinetI18n.t("msg.40a7962693"),"help-text"));return;}
        container.append(element("p",globalThis.OpenCabinetI18n.t("msg.8ddb35aa90"),"help-text"));
        const label=element("label",globalThis.OpenCabinetI18n.t("msg.dcec58b721")),select=element("select");select.id="game-default-region";
        game.regions.forEach(region=>{const option=element("option",region.label);option.value=region.game.id;select.append(option);});select.value=String(defaultId);select.onchange=()=>{defaultId=Number(select.value);};label.append(select);container.append(label);
        game.regions.forEach((region,index)=>{
          const row=element("div",null,"region-edit-row");const input=element("input");input.value=labels[index].label;input.maxLength=100;input.autocomplete="off";input.setAttribute("aria-label",globalThis.OpenCabinetI18n.t("msg.33ac393f9d"));input.oninput=()=>{labels[index].label=input.value;};
          const edit=button(region.game.id===editingId?globalThis.OpenCabinetI18n.t("msg.957a90ec0d"):globalThis.OpenCabinetI18n.t("msg.e477d2b2ff"),()=>onEdit(region.game,game));edit.disabled=region.game.id===editingId;
          row.append(input,element("span",`${region.game.discs.length} ${region.game.discs.length===1?globalThis.OpenCabinetI18n.t("msg.247a8174ec"):globalThis.OpenCabinetI18n.t("msg.c2ab077beb")}`,"disc-filename"),edit);container.append(row);
        });
      },
      value(){return group?.regions?.length?{parent_id:group.id,default_id:defaultId,labels:labels.map(label=>({...label}))}:null;},
    };
  }
  root.OpenCabinetRegions={guess,members,selected,chooseRegion,mergeGames,createEditor};
})(typeof window === "undefined" ? globalThis : window);
