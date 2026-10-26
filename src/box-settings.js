// Console-specific box appearance. Everything stays a draft until the console is saved.
(() => {
  const copy = value => JSON.parse(JSON.stringify(value));
  const regionTags = { europe: "Europe", north_america: "USA", japan: "Japan" };
  function createEditor({ imageSource, prefix = "platform" }) {
    const get = id => document.getElementById(`${prefix}-box-${id}`);
    const region = get("region"), inherit = get("inherit"), model = get("model"), spine = get("spine");
    const color = get("color"), autoColor = get("auto-color"), dimensions = [get("width"), get("height"), get("depth")];
    const section = get("settings");
    let settings = { base: {}, regions: {} }, scope = "base", platform = "", games = [], busy = false;
    let active = false, inheritedSettings = null;
    const viewer = OpenCabinet3D.createViewer(get("preview"), { imageSource, onProfile(profile) {
      get("preview-label").textContent = globalThis.OpenCabinetI18n.t("msg.aec7dea121", profile.label, profile.width, profile.height, profile.depth);
    } });
    const addOption = (value, label) => { const option = document.createElement("option"); option.value = value; option.textContent = label; model.appendChild(option); };
    addOption("", globalThis.OpenCabinetI18n.t("msg.07b458a943"));
    OpenCabinet3D.formats.forEach(format => addOption(format.id, `${format.label} · ${format.width} × ${format.height} × ${format.depth} mm`));
    addOption("custom", globalThis.OpenCabinetI18n.t("msg.7cccad0ceb"));
    function refresh() {
      const inherited = scope !== "base" && inherit.checked;
      get("inherit-row").classList.toggle("hidden", scope === "base");
      get("fields").classList.toggle("hidden", inherited);
      get("dimensions").classList.toggle("hidden", model.value !== "custom");
      [model, spine, autoColor].forEach(control => { control.disabled = busy || inherited; });
      color.disabled = busy || inherited || autoColor.checked;
      dimensions.forEach(control => { control.disabled = busy || inherited || model.value !== "custom"; control.required = !control.disabled; });
      region.disabled = busy; inherit.disabled = busy;
      document.getElementById(`btn-reset-${prefix}-box`).disabled = busy;
      if (!active || !section.open) return;
      const sample = games.find(game => OpenCabinet3D.regionFor(game.rom_path) === scope) || games[0];
      const game = { ...sample, id: "box-preview", title: sample?.title || platform, platform, box_3d: null,
        rom_path: scope === "base" ? "Preview.rom" : `Preview (${regionTags[scope]}).rom` };
      viewer.update(game, sample?.images || [], OpenCabinet3D.resolveSettings(inheritedSettings, settings));
    }
    function read() {
      if (scope !== "base" && inherit.checked) delete settings.regions[scope];
      else {
        const style = { model: model.value || null, spine_face: spine.value || null, color: autoColor.checked ? null : color.value };
        if (model.value === "custom") dimensions.forEach((control, i) => { style[["width", "height", "depth"][i]] = control.value === "" ? null : Number(control.value); });
        if (scope === "base") settings.base = style; else settings.regions[scope] = style;
      }
      const profile = OpenCabinet3D.profileFor(platform, null, scope === "base" ? "Preview.rom" : `Preview (${regionTags[scope]}).rom`, OpenCabinet3D.resolveSettings(inheritedSettings, settings));
      if (autoColor.checked) color.value = profile.color;
      if (model.value !== "custom") dimensions.forEach((control, i) => { control.value = Number(profile[["width", "height", "depth"][i]].toFixed(1)); });
      refresh();
    }
    function display() {
      const style = (scope === "base" ? settings.base : settings.regions[scope]) || settings.base;
      inherit.checked = scope !== "base" && !settings.regions[scope];
      model.value = style.model || ""; spine.value = style.spine_face || "";
      autoColor.checked = !style.color;
      const automatic = OpenCabinet3D.profileFor(platform, null, scope === "base" ? "Preview.rom" : `Preview (${regionTags[scope]}).rom`, OpenCabinet3D.resolveSettings(inheritedSettings, { base: style }));
      color.value = style.color || automatic.color;
      dimensions.forEach((control, i) => { control.value = style[["width", "height", "depth"][i]] ?? Number(automatic[["width", "height", "depth"][i]].toFixed(1)); });
      refresh();
    }
    region.onchange = () => { scope = region.value; display(); };
    inherit.onchange = () => {
      if (inherit.checked) delete settings.regions[scope]; else settings.regions[scope] = copy(settings.base);
      display();
    };
    [model, spine, autoColor, color, ...dimensions].forEach(control => { control.oninput = read; control.onchange = read; });
    document.getElementById(`btn-reset-${prefix}-box`).onclick = () => {
      if (scope === "base") settings.base = {}; else delete settings.regions[scope];
      display();
    };
    section.addEventListener("toggle", () => { if (section.open) refresh(); else viewer.clear(); });
    return {
      open(value, name, examples, defaults = null) { inheritedSettings = defaults; settings = copy(value || { base: {}, regions: {} }); settings.base ||= {}; settings.regions ||= {}; platform = name; games = examples; scope = region.value = "base"; active = true; viewer.clear(); display(); },
      getValue() {
        read();
        for (const style of [settings.base, ...Object.values(settings.regions)]) {
          if (style.model === "custom" && [style.width, style.height, style.depth].some((value, i) => !Number.isFinite(value) || value < (i === 2 ? 1 : 20) || value > (i === 2 ? 150 : 500))) {
            throw new Error(globalThis.OpenCabinetI18n.t("msg.0ee2b28d13"));
          }
        }
        return copy(settings);
      },
      setBusy(value) { busy = value; refresh(); },
      close() { active = false; viewer.clear(); },
    };
  }
  globalThis.OpenCabinetBoxSettings = { createEditor };
})();
