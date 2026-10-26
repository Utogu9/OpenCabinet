(function (root) {
  "use strict";
  const own = (object, name) => Object.prototype.hasOwnProperty.call(object || {}, name);
  const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const canonical = value => {
    const text = normalize(value);
    if (["yes","si","true","1"].includes(text)) return "yes";
    if (["no","false","0"].includes(text)) return "no";
    return text;
  };
  const truth = value => canonical(value) === "yes";
  const active = value => value != null && !["no", "false"].includes(normalize(value));
  const activeValues = values => Object.fromEntries(Object.entries(values).filter(([,value]) => active(value)));
  const validName = name => /^[a-z][a-z0-9_.-]{0,63}$/.test(name) && !["constructor","prototype"].includes(name);
  function platformDefaults(name, overrides = {}) {
    const compact = normalize(name).replace(/[^a-z0-9]/g, "");
    const pc = /^(pc|windows|pcgames|pcwindows|microsoftwindows|windowsgames|linux|macos|applemacintosh|msdos|dos)$/.test(compact);
    const portable = /game\s*boy|game\s*gear|game\s*&\s*watch|lynx|wonderswan|neo\s*geo\s*pocket|psp|playstation\s*(portable|vita)|\bps\s*vita\b|nintendo\s*(ds|3ds|2ds|switch)|virtual\s*boy|\bnds\b|\b3ds\b/i.test(name || "");
    return { pc: pc ? "yes" : "no", portatil: portable ? "yes" : "no", consola: !truth(overrides.pc ?? (pc ? "yes" : "no")) && !truth(overrides.portatil ?? (portable ? "yes" : "no")) ? "yes" : "no" };
  }
  function platformValues(platform, context = {}) {
    const overrides = context.platforms?.[platform?.id] || {};
    const result = { ...platformDefaults(platform?.name), ...overrides };
    if (!own(overrides,"consola")) result.consola = !truth(result.pc) && !truth(result.portatil) ? "yes" : "no";
    return activeValues(result);
  }
  function gameDefaults(game, platform) {
    return { ...platform, pc: game.steam_app_id != null || game.epic_app_id ? "yes" : platform.pc ?? "no",
      steam: game.steam_app_id != null ? "yes" : "no", epic: game.epic_app_id ? "yes" : "no" };
  }
  function gameValues(game, platform, context = {}) {
    game = game.regions?.find(region => region.game.id === game.default_region_id)?.game || game;
    return activeValues({ ...gameDefaults(game, platformValues(platform || { name: game.platform }, context)), ...(context.games?.[game.id] || {}) });
  }
  function matches(condition, game, platform, context = {}) {
    if (!validName(condition.name)) return false;
    const variables = condition.scope === "platform" ? platformValues(platform,context) : gameValues(game,platform,context);
    const exists = own(variables,condition.name);
    if (condition.operator === "exists") return exists;
    if (condition.operator === "not_exists") return !exists;
    const actual = exists ? variables[condition.name] : "no", expected = condition.value;
    if (condition.operator === "eq") return canonical(actual) === canonical(expected);
    if (condition.operator === "neq") return canonical(actual) !== canonical(expected);
    if (!exists) return false;
    if (condition.operator === "contains") return normalize(actual).includes(normalize(expected));
    if (!String(actual).trim() || !String(expected).trim()) return false;
    const a = Number(actual), b = Number(expected);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return ({ gt: () => a > b, gte: () => a >= b, lt: () => a < b, lte: () => a <= b })[condition.operator]?.() ?? false;
  }
  function knownNames(context = {}) {
    const names = new Set(["steam", "epic", "pc", "portatil", "consola"]);
    for (const values of [...Object.values(context.games || {}), ...Object.values(context.platforms || {})]) {
      Object.entries(values).forEach(([name,value]) => { if (validName(name) && active(value)) names.add(name); });
    }
    return [...names].sort();
  }
  let nextEditor = 0;
  function createEditor(container, document, { getNames = () => [] } = {}) {
    let base = {}, stored = {}, rows = [], initial = new Set(), disabled = new Set();
    const list = document.createElement("div"); list.className = "entity-variable-list";
    const add = document.createElement("button"); add.type = "button"; add.className = "secondary-btn"; add.textContent = globalThis.OpenCabinetI18n.t("msg.12d74ae077");
    const suggestions = document.createElement("datalist"); suggestions.id = `entity-variable-names-${++nextEditor}`;
    container.replaceChildren(list,add,suggestions);
    function suggest() {
      const used = new Set(rows.map(({input})=>input.value.trim().toLowerCase()));
      suggestions.replaceChildren();
      const names = new Set([...knownNames(), ...getNames(), ...Object.keys(base), ...Object.keys(stored)]);
      [...names].filter(name=>validName(name)&&!used.has(name)).sort().forEach(name=>{
        const option=document.createElement("option");option.value=name;suggestions.appendChild(option);
      });
    }
    function append(name = "", value = "yes") {
      const row = document.createElement("div"); row.className = "entity-variable-row";
      const input = document.createElement("input"); input.type = "text"; input.value = name; input.placeholder = "nombre_variable"; input.maxLength = 64; input.autocomplete = "off"; input.setAttribute("aria-label",globalThis.OpenCabinetI18n.t("msg.7cf9626489"));
      input.setAttribute("list",suggestions.id); input.oninput = suggest;
      const field = document.createElement("input"); field.type = "text"; field.value = value; field.placeholder = globalThis.OpenCabinetI18n.t("msg.c3962d76e9"); field.maxLength = 500; field.autocomplete = "off"; field.setAttribute("aria-label",globalThis.OpenCabinetI18n.t("msg.9f72458eb8", name || "variable"));
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary-btn"; remove.textContent = "🗑️"; remove.setAttribute("aria-label",`Quitar variable ${name}`);
      const item = { input,field,row }; rows.push(item);
      const discard = () => { disabled.add(input.value.trim().toLowerCase()); rows = rows.filter(r => r !== item); row.remove(); suggest(); };
      remove.onclick = discard;
      field.onchange = () => { if (!active(field.value)) discard(); };
      row.append(input,field,remove); list.appendChild(row); return input;
    }
    add.onclick = () => { const input=append();suggest();input.focus(); };
    return {
      set(defaults, overrides = {}) {
        base = { ...defaults }; stored = { ...overrides }; rows = []; disabled=new Set();list.replaceChildren();
        const effective=activeValues({ ...base,...stored });initial=new Set(Object.keys(effective));
        Object.entries(effective).sort(([a],[b])=>a.localeCompare(b)).forEach(([name,value]) => append(name,value));suggest();
      },
      value() {
        const result = Object.create(null), seen = new Set();
        for (const { input,field } of rows) {
          const name = input.value.trim().toLowerCase(), value = field.value.trim();
          if (!name && !value) continue;
          if (!validName(name) || seen.has(name)) throw Error(globalThis.OpenCabinetI18n.t("msg.8787c81ac3"));
          seen.add(name);
          if (!active(value)) { disabled.add(name); continue; }
          disabled.delete(name);
          // Unchanged automatic/inherited values continue to follow the platform.
          if (own(stored,name) || !own(base,name) || value !== base[name]) result[name] = value;
        }
        // Negative overrides are hidden, but must mask positive inherited values.
        for (const name of new Set([...initial,...Object.keys(stored),...disabled])) {
          if (!own(result,name) && own(base,name) && active(base[name]) && (!seen.has(name) || disabled.has(name))) result[name]="no";
        }
        if (Object.keys(result).length > 100) throw Error(globalThis.OpenCabinetI18n.t("msg.7d6b47d82d"));
        return result;
      },
    };
  }
  root.OpenCabinetVariables = { platformDefaults, platformValues, gameDefaults, gameValues, truth, matches, validName, knownNames, createEditor };
})(typeof window !== "undefined" ? window : globalThis);
