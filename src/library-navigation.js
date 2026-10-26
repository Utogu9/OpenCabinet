(function (root) {
  "use strict";
  const modes = [
    ["platform", globalThis.OpenCabinetI18n.t("msg.9f52c41426")], ["categories", globalThis.OpenCabinetI18n.t("msg.7ef4eab73e")], ["developer", globalThis.OpenCabinetI18n.t("msg.38ba62181c")],
    ["publisher", globalThis.OpenCabinetI18n.t("msg.936a161c39")], ["manufacturer", globalThis.OpenCabinetI18n.t("msg.b79530ac7c")], ["date", globalThis.OpenCabinetI18n.t("msg.31b614ced2")],
    ["year", globalThis.OpenCabinetI18n.t("msg.4538cdea32")], ["hours", globalThis.OpenCabinetI18n.t("msg.a28c7c72ce")], ["sessions", globalThis.OpenCabinetI18n.t("msg.28c60e4793")],
  ];
  const rules = [["platforms", globalThis.OpenCabinetI18n.t("msg.c9c69cf5a8")], ["consoles", globalThis.OpenCabinetI18n.t("msg.c7c3e075a4")],
    ["handhelds", globalThis.OpenCabinetI18n.t("msg.6640468bdb")], ["pc", globalThis.OpenCabinetI18n.t("msg.e295b7ad98")],
    ["steam", globalThis.OpenCabinetI18n.t("msg.210dde74bc")], ["epic", globalThis.OpenCabinetI18n.t("msg.4f0de45ac1")], ["windows", globalThis.OpenCabinetI18n.t("msg.49ba04369d")], ["variables", globalThis.OpenCabinetI18n.t("msg.0bb04367b9")]];
  const key = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const alphabetic = (a, b) => a.localeCompare(b, globalThis.OpenCabinetI18n.locale, { numeric: true, sensitivity: "base" });
  const compact = value => key(value).replace(/[^a-z0-9]/g, "");
  const seconds = game => Math.max(0, Number(game.play_time_seconds ?? Number(game.play_time || 0) * 60) || 0);
  const pc = game => game.steam_app_id != null || Boolean(game.epic_app_id) || /^(pc|windows|pcgames|pcwindows|microsoftwindows|windowsgames|linux|macos|applemacintosh|msdos|dos)$/.test(compact(game.platform));
  const handheld = name => /game\s*boy|game\s*gear|game\s*&\s*watch|lynx|wonderswan|neo\s*geo\s*pocket|psp|playstation\s*(portable|vita)|\bps\s*vita\b|nintendo\s*(ds|3ds|2ds|switch)|virtual\s*boy|\bnds\b|\b3ds\b/i.test(name || "");
  function defaults() {
    return [
      { id: "consoles", name: globalThis.OpenCabinetI18n.t("msg.9f52c41426"), parent_id: null, rule: "consoles", platforms: [] },
      { id: "handhelds", name: globalThis.OpenCabinetI18n.t("msg.63119e4139"), parent_id: null, rule: "handhelds", platforms: [] },
      { id: "pc", name: "PC", parent_id: null, rule: "pc", platforms: [] },
      { id: "steam", name: "Steam", parent_id: "pc", rule: "steam", platforms: [] },
      { id: "epic", name: "Epic Games", parent_id: "pc", rule: "epic", platforms: [] },
      { id: "windows", name: "Windows", parent_id: "pc", rule: "windows", platforms: [] },
    ];
  }
  function manufacturer(game, manufacturers) {
    const saved = Object.entries(manufacturers || {}).find(([name]) => key(name) === key(game.platform))?.[1];
    if (saved?.trim()) return saved.trim();
    return /^(Nintendo|Sony|Sega|Microsoft|Atari|Bandai|SNK|NEC|Panasonic|Philips|Coleco|Mattel|Nokia)\b/i.exec(game.platform || "")?.[1] || globalThis.OpenCabinetI18n.t("msg.93c179096b");
  }
  function bucket(value, thresholds, labels) { return labels[thresholds.findIndex(n => value < n)] || labels.at(-1); }
  function values(game, mode, manufacturers = {}) {
    if (mode === "platform") return [game.platform];
    if (mode === "manufacturer") return [manufacturer(game, manufacturers)];
    if (mode === "developer" || mode === "publisher") {
      const names = String(game[mode] || "").split(/[;\n]/).map(s => s.trim()).filter(Boolean);
      return names.length ? [...new Set(names)] : [mode === "developer" ? globalThis.OpenCabinetI18n.t("msg.c8210d16d1") : globalThis.OpenCabinetI18n.t("msg.d899f6afcb")];
    }
    if (mode === "date" || mode === "year") {
      const date = /^\d{4}-\d{2}-\d{2}/.exec(game.release_date || "")?.[0];
      return [date ? (mode === "year" ? date.slice(0, 4) : date) : globalThis.OpenCabinetI18n.t("msg.a93e43d69f")];
    }
    if (mode === "hours") return [bucket(seconds(game), [1, 3600, 18000, 36000, 90000, 180000, 360000],
      [globalThis.OpenCabinetI18n.t("msg.4e191548a6"), globalThis.OpenCabinetI18n.t("msg.a08b64e042"), "1–5 h", "5–10 h", "10–25 h", "25–50 h", "50–100 h", globalThis.OpenCabinetI18n.t("msg.cfd2825f13")])];
    if (mode === "sessions") return [bucket(Math.max(0, Number(game.session_count) || 0), [1, 2, 6, 11, 26, 51, 101],
      [globalThis.OpenCabinetI18n.t("msg.4e191548a6"), globalThis.OpenCabinetI18n.t("time.once"), globalThis.OpenCabinetI18n.t("time.range", "2–5"), globalThis.OpenCabinetI18n.t("time.range", "6–10"), globalThis.OpenCabinetI18n.t("time.range", "11–25"), globalThis.OpenCabinetI18n.t("time.range", "26–50"), globalThis.OpenCabinetI18n.t("time.range", "51–100"), globalThis.OpenCabinetI18n.t("msg.7eabe01bd8")])];
    return [];
  }
  function compareGames(a, b, mode) {
    let diff = 0;
    if (mode === "hours") diff = seconds(b) - seconds(a);
    else if (mode === "sessions") diff = (b.session_count || 0) - (a.session_count || 0);
    else if (mode === "date" || mode === "year") diff = (b.release_date || "").localeCompare(a.release_date || "");
    return diff || alphabetic(a.title, b.title) || a.id - b.id;
  }
  function node(id, label, games, extra = {}) {
    return { id, label, ids: new Set(games.map(g => g.id)), children: [], ...extra };
  }
  function platformNodes(games, prefix) {
    const grouped = new Map();
    for (const game of games) {
      if (!grouped.has(game.platform)) grouped.set(game.platform, []);
      grouped.get(game.platform).push(game);
    }
    return [...grouped].sort(([a], [b]) => alphabetic(a, b)).map(([name, items]) => node(`${prefix}platform:${name}`, name, items, { platform: name }));
  }
  function categoriesTree(games, categories, platforms, context = {}) {
    const platformIds = new Map(platforms.map(p => [key(p.name), p.id]));
    const byName = new Map(platforms.map(p => [key(p.name),p]));
    const matches = (game, category) => {
      const variables = root.OpenCabinetVariables;
      const platform = byName.get(key(game.platform)) || { name: game.platform };
      if (category.rule === "variables") {
        if (!variables || !category.conditions?.length) return false;
        const check = condition => variables.matches(condition,game,platform,context);
        return category.match_mode === "any" ? category.conditions.some(check) : category.conditions.every(check);
      }
      if (variables && category.rule !== "platforms") {
        const data = variables.gameValues(game,platform,context), truth = name => variables.truth(data[name]);
        if (category.rule === "consoles") return truth("consola") && !truth("pc");
        if (category.rule === "handhelds") return truth("portatil") && !truth("pc");
        if (category.rule === "pc") return truth("pc");
        if (category.rule === "steam") return truth("steam");
        if (category.rule === "epic") return truth("epic");
        if (category.rule === "windows") return truth("pc") && !truth("steam") && !truth("epic");
      }
      if (category.rule === "consoles") return !pc(game) && !handheld(game.platform);
      if (category.rule === "handhelds") return !pc(game) && handheld(game.platform);
      if (category.rule === "pc") return pc(game);
      if (category.rule === "steam") return game.steam_app_id != null;
      if (category.rule === "epic") return Boolean(game.epic_app_id);
      if (category.rule === "windows") return pc(game) && game.steam_app_id == null && !game.epic_app_id;
      return category.platforms.includes(platformIds.get(key(game.platform)));
    };
    const seen = new Set();
    function build(category, ancestors = new Set()) {
      if (ancestors.has(category.id)) return null;
      const branch = new Set([...ancestors, category.id]);
      const children = categories.filter(c => c.parent_id === category.id).map(c => build(c, branch)).filter(Boolean);
      const childIds = new Set(children.flatMap(c => [...c.ids]));
      const direct = games.filter(g => matches(g, category));
      const result = node(`category:${category.id}`, category.name, direct);
      for (const id of childIds) result.ids.add(id);
      if (!result.ids.size) return null;
      const platforms = ["steam", "epic", "windows"].includes(category.rule) ? []
        : platformNodes(direct.filter(g => !childIds.has(g.id)), `${result.id}/`);
      result.children = [...children, ...platforms];
      for (const id of result.ids) seen.add(id);
      return result;
    }
    const roots = categories.filter(c => c.parent_id == null).map(c => build(c)).filter(Boolean);
    const missing = games.filter(g => !seen.has(g.id));
    if (missing.length) roots.push(node("uncategorized", globalThis.OpenCabinetI18n.t("msg.0208294ea4"), missing, { children: platformNodes(missing, "uncategorized/") }));
    return roots;
  }
  function groups(games, mode, categories = defaults(), platforms = [], manufacturers = {}, context = {}) {
    if (mode === "categories") return categoriesTree(games, categories, platforms, context);
    if (mode === "platform") return platformNodes(games, "");
    const grouped = new Map();
    for (const game of games) for (const value of values(game, mode, manufacturers)) {
      const id = `${mode}:${key(value)}`;
      if (!grouped.has(id)) grouped.set(id, node(id, value, []));
      grouped.get(id).ids.add(game.id);
    }
    const result = [...grouped.values()];
    if (mode === "hours" || mode === "sessions") {
      // Order buckets by their largest value, with unplayed games last.
      const score = group => Math.max(...games.filter(g => group.ids.has(g.id)).map(g => mode === "hours" ? seconds(g) : g.session_count || 0));
      return result.sort((a, b) => score(b) - score(a));
    }
    return result.sort((a, b) => mode === "year" || mode === "date"
      ? (a.label === globalThis.OpenCabinetI18n.t("msg.a93e43d69f") ? 1 : b.label === globalThis.OpenCabinetI18n.t("msg.a93e43d69f") ? -1 : b.label.localeCompare(a.label))
      : alphabetic(a.label, b.label));
  }
  function descendants(categories, id) {
    const found = new Set([id]);
    for (let previous = -1; previous !== found.size;) {
      previous = found.size;
      categories.forEach(c => { if (found.has(c.parent_id)) found.add(c.id); });
    }
    return found;
  }
  function removeCategory(categories, id) {
    const parent = categories.find(c => c.id === id)?.parent_id ?? null;
    return categories.filter(c => c.id !== id).map(c => c.parent_id === id ? { ...c, parent_id: parent } : c);
  }

  function createEditor({ document, invoke, getCategories, getPlatforms, getVariableNames = () => [], onSave }) {
    const get = id => document.getElementById(id);
    const dialog = get("library-categories-dialog"), form = get("library-categories-form");
    const list = get("library-category-list"), name = get("library-category-name");
    const parent = get("library-category-parent"), rule = get("library-category-rule"), choices = get("library-category-platforms");
    const error = get("library-categories-error");
    const conditionsBox = get("library-category-conditions"), conditionsList = get("library-condition-list");
    const matchMode = get("library-condition-mode");
    let draft = [], current = null, saving = false;
    for (const [value, label] of rules) { const option = document.createElement("option"); option.value = value; option.textContent = label; rule.appendChild(option); }
    function renderList() {
      list.replaceChildren();
      const visited = new Set();
      function append(parentId, depth) {
        for (const category of draft.filter(c => c.parent_id === parentId)) {
          if (visited.has(category.id)) continue;
          visited.add(category.id);
          const button = document.createElement("button"); button.type = "button"; button.className = "platform-filter";
          button.textContent = category.name || globalThis.OpenCabinetI18n.t("msg.c4dc040a07"); button.style.paddingLeft = `${12 + depth * 12}px`;
          button.dataset.categoryId = category.id;
          button.setAttribute("aria-pressed", String(category.id === current));
          button.onclick = () => { current = category.id; fill(); };
          list.appendChild(button); append(category.id, depth + 1);
        }
      }
      append(null, 0);
    }
    function fill() {
      renderList();
      const category = draft.find(c => c.id === current);
      get("library-category-fields").disabled = !category || saving;
      get("library-category-empty").classList.toggle("hidden", Boolean(category));
      if (!category) { name.value = ""; choices.replaceChildren(); return; }
      name.value = category.name; rule.value = category.rule;
      parent.replaceChildren();
      const top = document.createElement("option"); top.value = ""; top.textContent = globalThis.OpenCabinetI18n.t("msg.2e1bd28fc5"); parent.appendChild(top);
      const excluded = descendants(draft, category.id);
      for (const item of draft.filter(c => !excluded.has(c.id))) {
        const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; parent.appendChild(option);
      }
      parent.value = category.parent_id || "";
      choices.replaceChildren();
      for (const platform of [...getPlatforms()].sort((a, b) => alphabetic(a.name, b.name))) {
        const label = document.createElement("label"), input = document.createElement("input"); input.type = "checkbox";
        input.checked = category.platforms.includes(platform.id);
        input.onchange = () => { category.platforms = input.checked ? [...new Set([...category.platforms, platform.id])] : category.platforms.filter(id => id !== platform.id); };
        const text = document.createElement("span"); text.textContent = platform.name; label.append(input, text); choices.appendChild(label);
      }
      choices.classList.toggle("hidden", category.rule !== "platforms");
      renderConditions(category);
    }
    function renderConditions(category) {
      conditionsBox.classList.toggle("hidden",category.rule !== "variables");
      matchMode.value = category.match_mode || "all";
      conditionsList.replaceChildren();
      for (const condition of category.conditions || []) {
        const row = document.createElement("div"); row.className = "library-condition-row";
        const scope = document.createElement("select"), input = document.createElement("input"), operator = document.createElement("select"), value = document.createElement("input");
        for (const [id,label] of [["game",globalThis.OpenCabinetI18n.t("msg.f1a19535b4")],["platform",globalThis.OpenCabinetI18n.t("msg.e0236ea3bc")]]) { const o=document.createElement("option");o.value=id;o.textContent=label;scope.appendChild(o); }
        for (const [id,label] of [["eq",globalThis.OpenCabinetI18n.t("msg.424e3c0015")],["neq",globalThis.OpenCabinetI18n.t("msg.0bc4fb33dc")],["contains",globalThis.OpenCabinetI18n.t("msg.994101d351")],["exists",globalThis.OpenCabinetI18n.t("msg.f8300d8d87")],["not_exists",globalThis.OpenCabinetI18n.t("msg.583712bfd3")],["gt",globalThis.OpenCabinetI18n.t("msg.ec79c1e708")],["gte",globalThis.OpenCabinetI18n.t("msg.be5b280344")],["lt",globalThis.OpenCabinetI18n.t("msg.f1fbd8e8d2")],["lte",globalThis.OpenCabinetI18n.t("msg.c0183ecad2")]]) { const o=document.createElement("option");o.value=id;o.textContent=label;operator.appendChild(o); }
        scope.value=condition.scope;input.value=condition.name;input.placeholder=globalThis.OpenCabinetI18n.t("msg.e57e998726");input.autocomplete="off";input.setAttribute("list","library-variable-names");input.setAttribute("aria-label",globalThis.OpenCabinetI18n.t("msg.98e5489776"));
        operator.value=condition.operator;value.value=condition.value;value.placeholder=globalThis.OpenCabinetI18n.t("msg.b2f530c469");value.autocomplete="off";value.setAttribute("aria-label",globalThis.OpenCabinetI18n.t("msg.2cfaa8911d"));
        scope.setAttribute("aria-label",globalThis.OpenCabinetI18n.t("msg.c41bd0fc2d"));operator.setAttribute("aria-label",globalThis.OpenCabinetI18n.t("msg.a1e414dfa1"));
        const sync = () => { condition.scope=scope.value;condition.name=input.value.trim().toLowerCase();condition.operator=operator.value;condition.value=value.value;value.disabled=["exists","not_exists"].includes(operator.value); };
        scope.onchange=operator.onchange=sync;input.oninput=value.oninput=sync;sync();
        const remove=document.createElement("button");remove.type="button";remove.className="secondary-btn";remove.textContent="🗑️";remove.setAttribute("aria-label",globalThis.OpenCabinetI18n.t("msg.8c4a6cb711"));
        remove.onclick=()=>{category.conditions=category.conditions.filter(c=>c!==condition);renderConditions(category);};
        row.append(scope,input,operator,value,remove);conditionsList.appendChild(row);
      }
      const names=get("library-variable-names");names.replaceChildren();
      for (const name of [...new Set(["steam","epic","pc","portatil","consola",...getVariableNames()])].sort()) { const option=document.createElement("option");option.value=name;names.appendChild(option); }
    }
    matchMode.onchange=()=>{const category=draft.find(c=>c.id===current);if(category)category.match_mode=matchMode.value;};
    get("btn-add-library-condition").onclick=()=>{const category=draft.find(c=>c.id===current);if(!category)return;category.conditions||=[];category.conditions.push({scope:"game",name:"steam",operator:"eq",value:"yes"});renderConditions(category);};
    name.oninput = () => { const category = draft.find(c => c.id === current); if (category) { category.name = name.value; renderList(); } };
    parent.onchange = () => { const category = draft.find(c => c.id === current); if (category) { category.parent_id = parent.value || null; renderList(); } };
    rule.onchange = () => { const category = draft.find(c => c.id === current); if (category) { category.rule = rule.value; choices.classList.toggle("hidden", rule.value !== "platforms"); renderConditions(category); } };
    get("btn-new-library-category").onclick = () => {
      let label = globalThis.OpenCabinetI18n.t("msg.551962d2a4"), suffix = 1;
      while (draft.some(c => c.name === label)) label = globalThis.OpenCabinetI18n.t("msg.62b2baadfb", ++suffix);
      const id = root.crypto.randomUUID();
      draft.push({ id, name: label, parent_id: null, rule: "platforms", platforms: [] }); current = id; fill(); name.focus(); name.select();
    };
    get("btn-delete-library-category").onclick = () => { draft = removeCategory(draft, current); current = draft[0]?.id ?? null; fill(); };
    const close = () => { if (!saving) dialog.close(); };
    get("btn-close-library-categories").onclick = close;
    get("btn-cancel-library-categories").onclick = close;
    dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
    form.onsubmit = async event => {
      event.preventDefault(); if (saving) return;
      saving = true; error.textContent = "";
      dialog.querySelectorAll("button,input,select").forEach(el => { el.disabled = true; });
      try {
        const result = await invoke("save_library_categories", { categories: draft });
        onSave(result); dialog.close();
      } catch (reason) { error.textContent = String(reason); }
      finally { saving = false; dialog.querySelectorAll("button,input,select").forEach(el => { el.disabled = false; }); fill(); }
    };
    return { open() { if (dialog.open) return; draft = getCategories().map(c => ({ ...c, platforms: [...c.platforms], conditions:(c.conditions||[]).map(condition=>({...condition})) })); current = draft[0]?.id ?? null; error.textContent = ""; fill(); dialog.showModal(); } };
  }
  root.OpenCabinetLibrary = { modes, rules, defaults, groups, values, compareGames, descendants, removeCategory, createEditor };
})(typeof window !== "undefined" ? window : globalThis);
