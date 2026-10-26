(function (root) {
  const filename = path => path.split(/[\\/]/).pop();
  const pathKey = path => path.replace(/\\/g, "/").toLowerCase();
  const copy = discs => discs.map(disc => ({ ...disc }));
  function button(text, action, title = text) {
    const el = document.createElement("button");
    el.type = "button"; el.className = "secondary-btn"; el.textContent = text; el.title = title;
    el.setAttribute("aria-label", title); el.onclick = action; return el;
  }
  function element(tag, text, className) {
    const el = document.createElement(tag); if (text) el.textContent = text;
    if (className) el.className = className; return el;
  }
  function listEditor(container, get, change, { remove = true } = {}) {
    function render() {
      container.replaceChildren();
      get().forEach((disc, index) => {
        const row = element("div", null, "disc-edit-row");
        const label = element("input"); label.type = "text"; label.value = disc.label;
        label.required = true; label.autocomplete = "off"; label.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.dfdb923d9d", index + 1));
        label.oninput = () => { disc.label = label.value; change(); };
        const name = element("span", filename(disc.rom_path), "disc-filename"); name.title = disc.rom_path;
        const move = delta => { const discs = get(); [discs[index], discs[index + delta]] = [discs[index + delta], discs[index]]; change(); render(); };
        const up = button("↑", () => move(-1), globalThis.OpenCabinetI18n.t("msg.8a65a12ef8")); up.disabled = index === 0;
        const down = button("↓", () => move(1), globalThis.OpenCabinetI18n.t("msg.029308fef3")); down.disabled = index === get().length - 1;
        row.append(label, name, up, down);
        if (remove) { const del = button("🗑️", () => { get().splice(index, 1); change(); render(); }, globalThis.OpenCabinetI18n.t("msg.7747d0dbb7")); del.disabled = get().length <= 1; row.append(del); }
        container.append(row);
      });
    }
    return render;
  }
  function dialog(title) {
    const el = element("dialog", null, "disc-dialog");
    el.setAttribute("aria-label", title); el.append(element("h2", title)); document.body.append(el);
    return el;
  }
  function chooseDisc(game, discs) {
    return new Promise(resolve => {
      const modal = dialog(globalThis.OpenCabinetI18n.t("msg.cf69895107", game.title));
      modal.append(element("p", globalThis.OpenCabinetI18n.t("msg.595a858d18"), "help-text"));
      const list = element("div", null, "disc-choice-list");
      let done = false;
      function finish(id) { if (done) return; done = true; modal.close(); modal.remove(); resolve(id); }
      for (const disc of discs) {
        const item = button("", () => finish(disc.id)); item.classList.add("disc-choice"); item.disabled = !disc.available;
        item.append(element("strong", disc.label), element("span", filename(disc.rom_path)), ...(!disc.available ? [element("span", globalThis.OpenCabinetI18n.t("msg.0968c8c67d"), "disc-error")] : []));
        item.setAttribute("aria-label", `${disc.label} · ${filename(disc.rom_path)}${disc.available ? "" : globalThis.OpenCabinetI18n.t("msg.e0468aaaa1")}`);
        item.title = disc.rom_path; list.append(item);
      }
      modal.append(list, button(globalThis.OpenCabinetI18n.t("msg.bb9dbb406d"), () => finish(null)));
      modal.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
      let backdrop = false;
      modal.addEventListener("pointerdown", event => { backdrop = event.target === modal; });
      modal.addEventListener("click", event => { if (backdrop && event.target === modal) finish(null); backdrop = false; });
      modal.showModal();
    });
  }
  function createEditor(container, invoke, onError) {
    let discs = [], changed = false, generation = 0, busy = false, enabled = true;
    const render = listEditor(container, () => discs, () => { changed = true; });
    return {
      setGame(game) {
        generation++; busy = false; changed = false; enabled = !game.launch_directly && !game.steam_app_id && !game.epic_app_id;
        discs = copy(game.discs?.length ? game.discs : [{ rom_path: game.rom_path, label: filename(game.rom_path), id: null }]);
        container.closest("section").classList.toggle("hidden", !enabled); render();
      },
      get busy() { return busy; },
      value() { return enabled && changed ? copy(discs) : null; },
      async add() {
        if (busy || !enabled) return;
        const version = generation; busy = true;
        try {
          const picked = await invoke("pick_disc_files");
          if (version !== generation) return;
          const known = new Set(discs.map(d => pathKey(d.rom_path)));
          for (const disc of picked) { if (!known.has(pathKey(disc.rom_path))) { discs.push(disc); known.add(pathKey(disc.rom_path)); changed = true; } }
          render();
        } catch (error) { if (version === generation) onError(error); }
        finally { if (version === generation) busy = false; }
      },
    };
  }
  async function mergeGames(games, invoke) {
    const discs = (await Promise.all(games.map(game => invoke("get_game_discs", { id: game.id })))).flat();
    discs.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity));
    return new Promise(resolve => {
      const modal = dialog(globalThis.OpenCabinetI18n.t("msg.97b652f9bb"));
      modal.append(element("p", globalThis.OpenCabinetI18n.t("msg.6aeee74a6e"), "help-text"));
      const label = element("label", globalThis.OpenCabinetI18n.t("msg.cca33d89de")); const primary = element("select");
      primary.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.cca33d89de"));
      games.forEach(game => { const option = element("option", `${game.title} · ${filename(game.rom_path)}`); option.value = game.id; primary.append(option); });
      primary.value = String(games[0].id); label.append(primary); modal.append(label);
      const list = element("div", null, "disc-edit-list");
      listEditor(list, () => discs, () => {}, { remove: false })();
      const error = element("p", null, "disc-error"); error.setAttribute("role", "alert");
      let busy = false, done = false;
      function finish(result) { if (busy || done) return; done = true; modal.close(); modal.remove(); resolve(result); }
      const cancel = button(globalThis.OpenCabinetI18n.t("msg.bb9dbb406d"), () => finish(null));
      const confirm = button(globalThis.OpenCabinetI18n.t("msg.0976eb9b7c"), async () => {
        if (busy || discs.some(d => !d.label.trim())) { error.textContent = globalThis.OpenCabinetI18n.t("msg.30c2df729b"); return; }
        busy = true; error.textContent = "";
        const controls = [...modal.querySelectorAll("button,input,select")].map(el => [el, el.disabled]); controls.forEach(([el]) => { el.disabled = true; });
        try { const id = Number(primary.value); await invoke("merge_game_discs", { ids: games.map(g => g.id), primaryId: id, discs }); busy = false; finish(id); }
        catch (reason) { busy = false; error.textContent = String(reason); controls.forEach(([el, disabled]) => { el.disabled = disabled; }); }
      });
      const actions = element("div", null, "form-actions"); actions.append(cancel, confirm);
      modal.append(list, error, actions);
      modal.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
      modal.showModal();
    });
  }
  root.OpenCabinetDiscs = { chooseDisc, createEditor, mergeGames, pathKey, filename };
})(typeof window === "undefined" ? globalThis : window);
