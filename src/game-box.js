// Textured faces and curved case corners, composed by the browser's GPU.
// No animation loop at rest.
(() => {
  const formats = {
    dvd: [135, 190, 14, globalThis.OpenCabinetI18n.t("msg.20bbc6bf09"), "#16191f"],
    bluray: [135, 171, 14, globalThis.OpenCabinetI18n.t("msg.354389cfa5"), "#164578"],
    jewel: [142, 125, 10, globalThis.OpenCabinetI18n.t("msg.441ce1e28a"), "#363c43"],
    jewelPal: [142, 125, 17, globalThis.OpenCabinetI18n.t("msg.9d882b7221"), "#363c43"],
    longbox: [142, 209, 21, globalThis.OpenCabinetI18n.t("msg.204551d640"), "#30343a"],
    switch: [104, 170, 11, "Nintendo Switch", "#a7adb3"],
    ds: [135, 122, 14, "Nintendo DS", "#282c32"],
    dsPal: [135, 122, 20, "Nintendo DS PAL", "#282c32"],
    threeDs: [135, 122, 12, "Nintendo 3DS", "#e4e4e2"],
    psp: [99, 168, 14, "PSP", "#b9bdc3"],
    vita: [105, 135, 12, "PS Vita", "#15569b"],
    nes: [126, 179, 25, globalThis.OpenCabinetI18n.t("msg.86e725664e"), "#48464a"],
    snes: [178, 128, 32, globalThis.OpenCabinetI18n.t("msg.4f0129dd8c"), "#55525a", "top"],
    sfc: [105, 190, 30, "Super Famicom", "#55525a"],
    n64: [178, 128, 32, "Nintendo 64", "#48464a", "top"],
    gameBoy: [126, 126, 25, "Game Boy / Game Boy Advance", "#55525a"],
    gbaJapan: [135, 86, 23, globalThis.OpenCabinetI18n.t("msg.d81ecf11c2"), "#55525a", "top"],
    genesis: [135, 190, 25, "Mega Drive / Genesis", "#202328"],
    masterSystem: [135, 190, 25, globalThis.OpenCabinetI18n.t("msg.e508be04df"), "#343436"],
    gameCubeJapan: [107, 149, 17, globalThis.OpenCabinetI18n.t("msg.c0730a8434"), "#8b8f96"],
  };


  function jewelFamily(platform) {
    const name = String(platform || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (/^(sega)?dreamcast$/.test(name)) return "dreamcast";
    if (/^(sony)?(playstation1?|ps1?|psx)$/.test(name)) return "ps1";
    return null;
  }

  function regionFor(romPath = "") {
    // Use filename tags, never a parent directory's name. Preserve their order
    // for multi-region releases, just as image selection prioritizes ROM regions.
    const tags = String(romPath).split(/[\\/]/).pop().match(/\([^)]*\)/g) || [];
    for (const tag of tags) {
      for (const name of tag.slice(1, -1).split(/[,;]/).map(value => value.trim().toLowerCase())) {
        if (["europe", "european", "pal", "eu"].includes(name)) return "europe";
        if (["usa", "us", "north america", "canada"].includes(name)) return "north_america";
        if (["japan", "jp"].includes(name)) return "japan";
      }
    }
    return null;
  }

  function resolveSettings(platform, game) {
    if (!game) return platform;
    platform ||= { base: {}, regions: {} };
    const clean = style => Object.fromEntries(Object.entries(style || {}).filter(([,value]) => value != null));
    const base = { ...clean(platform.base), ...clean(game.base) };
    const regions = {};
    for (const region of new Set([...Object.keys(platform.regions || {}), ...Object.keys(game.regions || {})])) {
      regions[region] = { ...clean(platform.regions?.[region] || platform.base), ...clean(game.base), ...clean(game.regions?.[region]) };
    }
    return { base, regions };
  }
  function profileFor(platform, coverRatio = null, romPath = "", settings = null) {
    const name = String(platform || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const region = regionFor(romPath);
    const europe = region === "europe", japan = region === "japan";
    let id, color;
    if (/switch/.test(name)) id = "switch";
    else if (/3ds|2ds/.test(name)) id = "threeDs";
    else if (/^(nintendo)?dsi?$/.test(name)) id = europe ? "dsPal" : "ds";
    else if (/playstationportable|psp/.test(name)) id = "psp";
    else if (/playstationvita|psvita/.test(name)) id = "vita";
    else if (/playstation[345]|ps[345]|xboxone|xboxseries/.test(name)) {
      id = "bluray";
      if (/xbox/.test(name)) color = "#216a35";
      if (/playstation3|ps3/.test(name)) color = "#e5e8eb";
      if (/playstation[45]|ps[45]/.test(name)) color = "#2263b5";
    } else if (/playstation2|ps2|gamecube|wii|xbox|^(windows|pc|pcgames)$/.test(name)) {
      id = /gamecube/.test(name) && japan ? "gameCubeJapan" : "dvd";
      if (/wii/.test(name)) color = /wiiu/.test(name) ? "#1686ac" : "#d5d7d9";
      else if (/xbox/.test(name)) color = /360/.test(name) ? "#78b83e" : "#99b936";
      else if (/playstation2|ps2/.test(name) && europe) color = "#163c78";
    } else if (jewelFamily(platform) || /playstation|^ps1?$|dreamcast|segacd|megacd|saturn/.test(name)) {
      id = /segacd|megacd|saturn/.test(name) ? "longbox" : europe ? "jewelPal" : "jewel";
      if (/dreamcast/.test(name)) color = europe ? "#204b85" : "#b8c2c9";
    }
    else if (/superfamicom/.test(name)) id = "sfc";
    else if (/snes|supernintendo/.test(name)) id = coverRatio && coverRatio < 0.85 ? "sfc" : "snes";
    else if (/nintendo64|^n64$/.test(name)) id = "n64";
    else if (/gameboy|^gb[ac]?$/.test(name)) id = coverRatio && coverRatio > 1.25 ? "gbaJapan" : "gameBoy";
    else if (/mastersystem/.test(name)) id = "masterSystem";
    else if (/genesis|megadrive/.test(name)) id = "genesis";
    else if (/nintendoentertainmentsystem|^(nintendo)?nes$|famicom/.test(name)) id = "nes";
    else id = "generic";
    const [width, height, depth, label, material, spineFace = "left"] = formats[id]
      || [Math.max(80, Math.min(220, 170 * (coverRatio || 0.71))), 170, 16, globalThis.OpenCabinetI18n.t("msg.be9c16b897"), "#353b46"];
    let profile = { id, width, height, depth, label, color: color || material, spineFace };
    // A regional override replaces the general style; absence inherits it.
    const style = settings?.regions?.[region] || settings?.base;
    if (!style) return describeCase(profile, name);
    if (formats[style.model]) {
      const [width, height, depth, label, color, spineFace = "left"] = formats[style.model];
      profile = { id: style.model, width, height, depth, label, color, spineFace };
    } else if (style.model === "custom") {
      const valid = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
      if (valid(style.width, 20, 500) && valid(style.height, 20, 500) && valid(style.depth, 1, 150)) {
        profile = { ...profile, id: "custom", label: globalThis.OpenCabinetI18n.t("msg.79f5607317"), width: style.width, height: style.height, depth: style.depth, spineFace: "left" };
      }
    }
    if (/^#[\da-f]{6}$/i.test(style.color || "")) profile.color = style.color;
    if (["left", "top"].includes(style.spine_face)) profile.spineFace = style.spine_face;
    return describeCase(profile, name);
  }

  function describeCase(profile, name) {
    let variant = profile.id;
    if (profile.id === "dvd") {
      variant = /playstation2|ps2/.test(name) ? "ps2" : /gamecube/.test(name) ? "gamecube"
        : /wiiu/.test(name) ? "wiiu" : /wii/.test(name) ? "wii" : /xbox360/.test(name) ? "xbox360" : /xbox/.test(name) ? "xbox" : "dvd";
    } else if (profile.id === "bluray") {
      variant = /playstation3|ps3/.test(name) ? "ps3" : /playstation[45]|ps[45]/.test(name) ? "ps4" : "bluray";
    } else if (["jewel", "jewelPal"].includes(profile.id)) variant = /dreamcast/.test(name) ? "dreamcast" : "jewel";
    else if (profile.id === "gameCubeJapan") variant = "gamecube";
    else if(profile.id==='dsPal')variant='ds';
    const translucency = ["ps3", "psp", "switch", "jewel", "dreamcast", "longbox"].includes(variant) ? .18 : variant === "ps4" ? .38 : variant === "xbox360" ? .35 : variant === "xbox" ? .42 : 1;
    return { ...profile, variant, translucency, headerHeight: variant === "ps3" ? 14 : 0 };
  }

  const normalize = (q) => { const length = Math.hypot(...q) || 1; return q.map((n) => n / length); };
  function multiply(a, b) {
    const [x, y, z, w] = a, [u, v, t, s] = b;
    return normalize([w*u+x*s+y*t-z*v, w*v-x*t+y*s+z*u, w*t+x*v-y*u+z*s, w*s-x*u-y*v-z*t]);
  }
  function axisAngle(axis, degrees) {
    const angle = degrees * Math.PI / 360;
    return [...axis.map((n) => n * Math.sin(angle)), Math.cos(angle)];
  }
  function between(a, b) {
    const dot = a.reduce((sum, n, i) => sum + n * b[i], 0);
    if (dot < -0.999999) {
      const axis = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[1], a[0], 0];
      return normalize([...axis, 0]);
    }
    return normalize([a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0], 1+dot]);
  }
  function matrix(q) {
    const [x,y,z,w] = normalize(q);
    // Column-major, matching CSS matrix3d. Translation is always zero.
    return [1-2*(y*y+z*z), 2*(x*y+z*w), 2*(x*z-y*w), 0,
      2*(x*y-z*w), 1-2*(x*x+z*z), 2*(y*z+x*w), 0,
      2*(x*z+y*w), 2*(y*z-x*w), 1-2*(x*x+y*y), 0, 0,0,0,1];
  }
  function rotate(q, v) {
    const m = matrix(q);
    return [m[0]*v[0]+m[4]*v[1]+m[8]*v[2], m[1]*v[0]+m[5]*v[1]+m[9]*v[2], m[2]*v[0]+m[6]*v[1]+m[10]*v[2]];
  }
  const initialRotation = () => multiply(axisAngle([1,0,0], -9), axisAngle([0,1,0], 28));

  function createViewer(host, { imageSource = (path) => path, getCoverPreview = () => null, loadCoverPreview = null, onProfile = () => {}, onOpenState = () => {}, loadManual = null, onManualState = () => {}, onManualCoverChange = () => {}, onManualActivate = () => false, onManualDeactivate = () => {} } = {}) {
    const dvd = globalThis.OpenCabinetDVD;
    const model = document.createElement("div"); model.className = "game-box-model";
    model.setAttribute("aria-hidden", "true"); host.replaceChildren(model);
    let game = null, images = [], profile = null, key = null, settings = null;
    let rotation = initialRotation(), zoom = 1, drag = null, frame = null, viewSide = "front";
    let rotationLock = "free", menu = null, menuButtons = [];
    host.dataset.rotationLock = rotationLock;
    let layoutScale = null, viewport = null, viewportFill = .86, cornerRadii = [0, 0, 0, 0];
    let revision = 0, disposed = false, faces = [], textures = [];
    let parts = null, previews = [], lastLightAt = -Infinity, lastLightKey = "", referenceDiameter = 1;
    let lightGroups=new Map(), lightPass=0;
    let opened = 0, openTarget = false, opening = null, interiorBuilt = false, layoutOpening = null;
    let interior = null, paperLayout = null, manualData = null, manualTask = null, manualGeneration = 0;
    let manualResolved = false;
    let rejectedFullCover = false;
    let fullPreviewUrl = null, fullPreviewController = null;
    function jewelManualCover(data) {
      const front=faces.find(face=>face.element.dataset.face==='front')?.element;
      if(!front)return;
      front.children && Array.from(front.children).filter(child=>child.className==='game-box-jewel-manual-cover').forEach(child=>child.remove());
      if(!data || !['jewel','jewelPal'].includes(profile.id)) {delete model.dataset.manualCover;return;}
      const canvas=data.front;canvas.className='game-box-jewel-manual-cover';
      canvas.dataset ||= {};canvas.dataset.manualBooklet='true';
      const image=Array.from(front.children).find(child=>child.tagName==='IMG'||child.tag==='img');
      canvas.style ||= {};
      Object.assign(canvas.style,image ? {left:image.style.left,top:image.style.top,width:image.style.width,height:image.style.height}
        : {left:(13.3/profile.width*100)+'%',top:(1.3/profile.height*100)+'%',width:((profile.width-14.6)/profile.width*100)+'%',height:((profile.height-2.6)/profile.height*100)+'%'});
      front.appendChild(canvas);model.dataset.manualCover='ready';
    }
    function clearManual() {
      closeMenu();
      onManualDeactivate(); delete model.dataset.manualExtracted;
      ++manualGeneration; manualTask?.abort(); manualTask = null;
      jewelManualCover(null);interior?.setManual(null); manualData?.dispose(); manualData = null;
      manualResolved = false;
      delete model.dataset.manual;
    }
    async function ensureManual() {
      if (!loadManual || !dvd?.canOpen(profile) || !globalThis.OpenCabinetManualPDF?.supportsGame(game) || manualTask || manualResolved) return;
      const generation = ++manualGeneration, token = revision;
      const task = new AbortController(); manualTask = task;
      const current = () => !disposed && token === revision && generation === manualGeneration && !task.signal.aborted;
      onManualState({ status: "loading" });
      try {
        const data = await loadManual(game, task.signal);
        if (!current()) { data?.dispose(); return; }
        if (data) {
          manualData = data;
          jewelManualCover(data);
          const size = interior?.setManual(data) ?? globalThis.OpenCabinetManualPDF.dimensions(profile, data);
          model.dataset.manual = "ready";
          onManualState({ status: "ready", path: data.path, pageCount: data.pageCount,
            sourceAspectRatio: data.sourceAspectRatio, coverMode: data.coverMode, ...size });
        } else { model.dataset.manual = "none"; onManualState({ status: "none" }); }
      } catch (error) {
        if (current()) {
          jewelManualCover(null);interior?.setManual(null); manualData?.dispose(); manualData = null;
          model.dataset.manual = "error"; onManualState({ status: "error", message: String(error?.message || error) });
        }
      } finally {
        if (current()) { layoutScale = null; lastLightKey = ""; manualTask = null; manualResolved = true; schedule(); }
      }
    }
    const listeners = [];
    const listen = (name, handler, options, target = host) => {
      target.addEventListener?.(name, handler, options); listeners.push([target, name, handler, options]);
    };
    const inMenu = target => menu && (target === menu || menu.contains(target));
    function closeMenu(restoreFocus = false) {
      if (!menu) return;
      menu.remove(); menu = null; menuButtons = [];
      if (restoreFocus) host.focus({ preventScroll: true });
    }
    listen("contextmenu", event => {
      if (!game) return;
      event.preventDefault(); event.stopPropagation(); stopDrag(); closeMenu();
      menu = document.createElement("div"); menu.className = "game-box-context-menu";
      menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.8b216b8e9f"));
      for (const [mode, label] of [["free", globalThis.OpenCabinetI18n.t("msg.fa61fab9d7")], ["x", globalThis.OpenCabinetI18n.t("msg.8a788eaa0a")], ["y", globalThis.OpenCabinetI18n.t("msg.d9db8b4117")]]) {
        const item = document.createElement("button"); item.type = "button"; item.className = "dropdown-item";
        item.textContent = label; item.setAttribute("role", "menuitemradio"); item.setAttribute("aria-checked", String(rotationLock === mode));
        item.addEventListener("click", event => { event.stopPropagation(); api.setRotationLock(mode); closeMenu(true); });
        menu.appendChild(item); menuButtons.push(item);
      }
      if (manualData) {
        const group = document.createElement("div"); group.setAttribute("role", "group"); group.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.26b484bdcb"));
        const heading = document.createElement("p"); heading.className = "game-box-menu-heading"; heading.textContent = globalThis.OpenCabinetI18n.t("msg.26b484bdcb");
        group.appendChild(heading);
        for (const [mode, label] of [["auto", globalThis.OpenCabinetI18n.t("msg.b803f24d52")], ["full", globalThis.OpenCabinetI18n.t("msg.b6616b1d67")], ["right", globalThis.OpenCabinetI18n.t("msg.dc5f5de445")], ["left", globalThis.OpenCabinetI18n.t("msg.bd88b698c2")]]) {
          const item = document.createElement("button"); item.type = "button"; item.className = "dropdown-item";
          item.textContent = label; item.setAttribute("role", "menuitemradio"); item.setAttribute("aria-checked", String((manualData.coverMode || "auto") === mode));
          item.addEventListener("click", event => {
            event.stopPropagation(); const changed = (manualData.coverMode || "auto") !== mode;
            closeMenu(true); if (changed) onManualCoverChange(mode);
          });
          group.appendChild(item); menuButtons.push(item);
        }
        menu.appendChild(group);
      }
      menu.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault(); const index = menuButtons.indexOf(event.target);
          const count = menuButtons.length;
          const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : (index + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
          menuButtons[next].focus({ preventScroll: true });
        } else if (event.key === "Tab") closeMenu();
      });
      host.appendChild(menu);
      const rect = host.getBoundingClientRect(), keyboard = !event.clientX && !event.clientY;
      const x = keyboard ? rect.width / 2 : event.clientX - rect.left;
      const y = keyboard ? rect.height / 2 : event.clientY - rect.top;
      menu.style.left = `${Math.max(8, Math.min(x, rect.width - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, rect.height - menu.offsetHeight - 8))}px`;
      menuButtons.find(item => item.getAttribute("aria-checked") === "true").focus({ preventScroll: true });
    });
    listen("pointerdown", event => { if (!inMenu(event.target)) closeMenu(); }, true, document);

    function paint(timestamp) {
      frame = null;
      if (disposed || !profile) return;
      if (opening) {
        const now = Number.isFinite(timestamp) ? timestamp : Date.now();
        opening.started ??= now;
        const progress = Math.min(1, Math.max(0, (now - opening.started) / 650));
        const eased = progress * progress * (3 - 2 * progress);
        opened = opening.from + (opening.to - opening.from) * eased;
        if (progress === 1) opening = null;
      }
      // Rotation doesn't change the viewport. Measure only after a resize,
      // before any DOM writes, rather than synchronously reading layout per frame.
      if (!viewport) {
        viewport = host.getBoundingClientRect();
        // The compact sidebar needs less framing; fullscreen and previews keep
        // their original framing. Cache this together with the viewport bounds.
        viewportFill = host.closest?.("#game-box-slot") ? .98 : .86;
      }
      const rect = viewport;
      const movement = dvd?.canOpen(profile) ? dvd.motion(profile, opened) : null;
      const openValue = String(opened > 0), manualValue = String(opened === 1 && !!manualData && model.dataset.manualExtracted !== "true");
      if (model.dataset.open !== openValue) model.dataset.open = openValue;
      if (model.dataset.manualInteractive !== manualValue) model.dataset.manualInteractive = manualValue;
      const diameter = movement?.diameter || Math.hypot(profile.width, profile.height, profile.depth);
      const scale = Math.max(0.01, Math.min(rect.width, rect.height) * viewportFill / diameter) * zoom;
      // Lay out at the largest displayed size; opening only scales DOWN and
      // moves three rigid assemblies. Zoom/fullscreen still refresh resolution.
      const geometryScale = Math.max(scale, Math.max(.01, Math.min(rect.width, rect.height) * viewportFill / referenceDiameter) * zoom);
      if (geometryScale !== layoutScale) {
        layoutScale = geometryScale;
        model.style.setProperty("--box-scale", String(geometryScale));
        ["tl", "tr", "br", "bl"].forEach((corner, index) => model.style.setProperty(`--box-corner-${corner}`, `${cornerRadii[index] * geometryScale}px`));
        faces.forEach(({ element, width, height, transform, texture }) => {
          Object.assign(element.style, { width: `${width * geometryScale}px`, height: `${height * geometryScale}px`,
            left: `${-width * geometryScale / 2}px`, top: `${-height * geometryScale / 2}px`, transform: transform(geometryScale) });
          if (texture) Object.assign(texture.art.style, {
            width: `${texture.width * geometryScale}px`, height: `${texture.height * geometryScale}px`,
            left: `${(width/2 - texture.u * texture.sx) * geometryScale}px`, top: `${(height/2 - texture.v * texture.sy) * geometryScale}px`,
            transform: `scale(${texture.sx}, ${texture.sy})`,
          });
        });
      }
      if (layoutOpening !== (opened > 0)) {
        layoutOpening = opened > 0;
        faces.forEach(({ element, interior, closedOnly }) => {
          element.style.display = (interior && !layoutOpening) || (closedOnly && layoutOpening) ? "none" : "";
        });
      }
      if (parts) {
        const lid = movement ? movement.lid(geometryScale) : "", spine = movement ? movement.spine(geometryScale) : "";
        if (parts.lid.style.transform !== lid) parts.lid.style.transform = lid;
        if (parts.spine.style.transform !== spine) parts.spine.style.transform = spine;
      }
      const center = movement && movement.center.some(value=>Math.abs(value)>1e-9) ? ` translate3d(${-movement.center[0]*scale}px,0,${-movement.center[1]*scale}px)` : "";
      const ratio = scale / geometryScale;
      model.style.transform = `matrix3d(${matrix(rotation).join(",")})` + center + (ratio < 1 ? ` scale3d(${ratio},${ratio},${ratio})` : "");
      const lidRotation = movement && axisAngle([0,1,0], -movement.angle);
      const spineRotation = movement && axisAngle([0,1,0], -movement.angle/2);
      const matrices = { tray: matrix(rotation), lid: matrix(lidRotation ? multiply(rotation, lidRotation) : rotation),
        spine: matrix(spineRotation ? multiply(rotation, spineRotation) : rotation) };
      // Explicitly cull paper backs before compositor depth sorting; their
      // image/canvas descendants must not override the inherited visibility.
      for(const face of faces) {
        if(face.lighting!=='paper'||face.paperOccluded)continue;
        if ((face.interior&&!opened)||(face.closedOnly&&opened))continue;
        face.twoSided ??= face.element.style.backfaceVisibility==='visible';
        if(face.twoSided)continue;
        const m=matrices[face.part]||matrices.tray,n=face.normal;
        const culled=m[2]*n[0]+m[6]*n[1]+m[10]*n[2] < 0;
        if(culled!==face.culled) {
          face.culled=culled;
          face.element.classList[culled?'add':'remove']('game-box-face-culled');
        }
      }
      const lightKey = `${rotation.join(",")}:${opened}:${revision}:${faces.length}`;
      const now = Number.isFinite(timestamp) ? timestamp : Infinity;
      if (lightKey !== lastLightKey) {
        if (!Number.isFinite(timestamp) || !Number.isFinite(lastLightAt) || now - lastLightAt >= 1000/30) {
          lastLightAt = now; lastLightKey = lightKey;
          const cache = new Map();
          const lighting = (normal, part = "tray") => {
            const key = `${part}:${normal.join(",")}`; if (cache.has(key)) return cache.get(key);
            const m = matrices[part] || matrices.tray, [x,y,z] = normal;
            const n = [m[0]*x+m[4]*y+m[8]*z, m[1]*x+m[5]*y+m[9]*z, m[2]*x+m[6]*y+m[10]*z];
            const light = Math.max(0, n[0]*-.35+n[1]*-.45+n[2]*.82);
            const value = { n, shade: Math.max(.04,.5-light*.46), gloss: Math.max(0,n[2])*.2,
              angle: 110+n[0]*35+n[1]*20, reflection: 50-n[0]*70,
              curveGloss: .025+Math.pow(Math.max(0,n[0]*-.2+n[1]*-.15+n[2]*.96),16)*.24 };
            cache.set(key,value); return value;
          };
          const set = (face, name, value, suffix = "") => {
            const text = Number(value.toFixed(3)) + suffix;
            const state=face.lightGroup||face;
            state.light ||= {};
            if (state.light[name] !== text) { state.light[name] = text; state.element.style.setProperty(name, text); }
          };
          lightPass++;
          faces.forEach(face => {
            if (face.paperOccluded || (face.interior && !opened) || (face.closedOnly && opened)) return;
            if(face.lightGroup) {
              if(face.lightGroup.pass===lightPass)return;
              face.lightGroup.pass=lightPass;
            }
            const value = lighting(face.normal, face.part);
            if (value.n[2] < -.01) return; // Back-facing surfaces cannot contribute a pixel.
            // Curved interior plastic uses only the two endpoint shades. Its
            // hidden sleeve highlight and midpoint variables contribute no
            // pixels but previously invalidated styles on hundreds of faces.
            if(!face.interior||!face.curve) {
              set(face,"--box-shade",value.shade);
              const shadeOnly=face.interior&&/manual-clip|dvd-hub-arm|dvd-hub-button/.test(face.element.className);
              if (face.lighting !== "paper"&&!shadeOnly) set(face,"--box-gloss",value.gloss);
            }
            // Interior plastic and paper have no sleeve reflection. Updating
            // unused inherited variables still invalidates their entire subtree.
            if (!face.interior || face.lighting === "disc") set(face,"--box-reflection-angle",value.angle,"deg");
            if (!face.interior) set(face,"--box-reflection-x",value.reflection,"%");
            face.curve?.normals.forEach((normal,index) => {
              const value = lighting(normal,face.part), end = index ? "end" : "start";
              set(face,`--box-shade-${end}`,value.shade);
              if (!face.interior) set(face,`--box-gloss-${end}`,value.curveGloss);
            });
          });
        } else schedule(); // Settle the final illumination, then return to idle.
      }
      if (opening) schedule();
    }
    function schedule() {
      if (!disposed && frame === null) frame = requestAnimationFrame(paint);
    }
    function clearTextures() {
      lightGroups=new Map();
      fullPreviewController?.abort(); fullPreviewController = null;
      if (fullPreviewUrl) URL.revokeObjectURL(fullPreviewUrl);
      fullPreviewUrl = null;
      delete model.dataset.fullCover;
      previews.forEach(canvas => { canvas.width = canvas.height = 0; canvas.remove(); }); previews = [];
      textures.forEach((image) => { image.onload = image.onerror = null; image.removeAttribute("src"); });
      textures = [];
      for (const kind of ["cover", "back_cover", "spine"]) {
        model.style.setProperty(`--box-texture-${kind}`, "none");
        model.style.setProperty(`--box-texture-size-${kind}`, "100% 100%");
        model.style.setProperty(`--box-texture-position-${kind}`, "0% 0%");
        model.style.setProperty(`--box-paper-${kind}`, 'var(--box-material)');
      }
      model.dataset.spineRotated = "false";
    }
    function notifyOpening() {
      onOpenState({ canOpen: !!dvd?.canOpen(profile), open: openTarget,
        hasDisc: images.some(image => image.kind === "disc") });
    }
    function ensureInterior() {
      if (interiorBuilt || !dvd?.canOpen(profile)) return;
      interiorBuilt = true;
      const token = revision;
      interior = dvd.build({ profile, game, images, paperLayout, imageSource, schedule,
        trackTexture: image => textures.push(image),
        isCurrent: () => !disposed && token === revision,
        addFace(face) {
          face.element.dataset.casePart = face.part;
          if(face.lighting==='plastic') {
            const shadeOnly=/manual-clip|dvd-hub-arm|dvd-hub-button/.test(face.element.className);
            // Trigonometric roundoff must not split identical orientations
            // into different groups. This tolerance is far below a light step.
            const normalKey=normal=>normal.map(n=>Number(n.toFixed(8)));
            const key=JSON.stringify([face.part,normalKey(face.normal),face.curve?.normals.map(normalKey),shadeOnly]);
            let group=lightGroups.get(key);
            if(!group) {
              const element=document.createElement('div');element.className='game-box-light-group';element.dataset.part=face.part;
              group={element};lightGroups.set(key,group);(parts?.[face.part]||model).appendChild(element);
            }
            face.lightGroup=group;
          }
          layoutOpening = null;
          faces.push(face); (face.lightGroup?.element || parts?.[face.part] || model).appendChild(face.element);
        },
        removeFace(element) { faces = faces.filter(face => face.element !== element); element.remove(); },
      });
      model.dataset.interior = interior.variant;
      // Opaque shells completely occlude their paper liner, except at molded
      // holes. Do not submit a full white sheet behind each opaque panel: CSS
      // 3D depth sorting can briefly paint it in front during a rotation.
      if((profile.translucency??1)===1&&!['jewel','jewelPal','longbox'].includes(profile.id)) {
        for(const face of faces) {
          if(face.element.dataset.paperFace==='front'&&face.paperOrigin&&interior.paperHoles.length) {
            const [x,y]=face.paperOrigin;
            const polygons=interior.paperHoles.map(points=>'<polygon fill="white" points="'+points.map(([u,v])=>[face.width/2-u+x,face.height/2+v-y].join(',')).join(' ')+'"/>').join('');
            face.element.style.maskImage='url("data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+face.width+' '+face.height+'">'+polygons+'</svg>')+'")';
            face.element.style.maskSize='100% 100%';face.element.dataset.paperExposure='cutouts';
          } else if(face.element.dataset.paperFace||face.element.dataset.paperSource) {
            face.element.classList.add('game-box-paper-occluded');face.paperOccluded=true;
          }
        }
      }
      layoutScale = null;
      layoutOpening = null;
      if (manualData) interior.setManual(manualData);
      else ensureManual();
    }
    function setOpen(value, animate = true) {
      if (!dvd?.canOpen(profile) || disposed) return false;
      if (!value) { onManualDeactivate(); delete model.dataset.manualExtracted; }
      stopDrag(); openTarget = !!value;
      if (openTarget) ensureInterior();
      const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      opening = animate && !reduceMotion && opened !== Number(openTarget)
        ? { from: opened, to: Number(openTarget), started: null } : null;
      if (!opening) opened = Number(openTarget);
      notifyOpening(); schedule(); return true;
    }
    function rebuild() {
      const token = ++revision;
      clearManual(); interior = null;
      clearTextures(); model.replaceChildren(); faces = []; parts = null; layoutScale = null; lastLightKey = "";
      interiorBuilt = false; layoutOpening = null; delete model.dataset.interior;
      referenceDiameter = dvd?.canOpen(profile) ? dvd.motion(profile, 0).diameter : Math.hypot(profile.width, profile.height, profile.depth);
      if (!dvd?.canOpen(profile)) { opened = 0; openTarget = false; opening = null; }
      model.style.setProperty("--box-material", profile.color);
      model.style.setProperty("--box-shell-opacity", String(profile.translucency ?? 1));
      model.style.setProperty("--box-header-height", `${profile.headerHeight || 0}px`);
      host.dataset.variant = model.dataset.variant = profile.variant;
      host.dataset.format = profile.id;
      host.dataset.spineFace = profile.spineFace;
      host.dataset.material = ["nes", "snes", "sfc", "n64", "gameBoy", "gbaJapan", "masterSystem"].includes(profile.id) ? "cardboard" : "plastic";
      onProfile(profile);
      const { width: w, height: h, depth: d } = profile;
      const cardboard = host.dataset.material === "cardboard";
      const jewel = ["jewel", "jewelPal", "longbox"].includes(profile.id);
      const topSpine = profile.spineFace === "top";
      const hingeWidth = jewel ? Math.min(12, (topSpine ? h : w) * 0.12) : 0;
      const lidThickness = jewel ? Math.min(1.6, d * 0.2) : 0;
      const lidShare = lidThickness / d * 100;
      const dreamcast = /dreamcast/i.test(game.platform);
      const region = regionFor(game.rom_path), style = settings?.regions?.[region] || settings?.base;
      const trayColor = /^#[\da-f]{6}$/i.test(style?.color || "") ? style.color : dreamcast ? (region === "europe" ? "#204b85" : "#b8c2c9") : "#181a1e";
      model.dataset.construction = jewel ? "jewel" : "sleeve";
      model.style.setProperty("--box-hinge-width", `${hingeWidth}px`);
      model.style.setProperty("--box-lid-share", `${lidShare}%`);
      model.style.setProperty("--box-tray-share", `${100 - lidShare}%`);
      model.style.setProperty("--box-jewel-tray", trayColor);
      const openingRadius = Math.min(cardboard ? 0 : profile.id==='genesis' ? .65 : jewel ? 1.2 : 3.2, w / 8, h / 8);
      const hingeRadius = Math.min(cardboard ? 0 : jewel ? 0.65 : 1.3, openingRadius);
      const foldRadius = jewel || cardboard ? 0 : Math.min(0.9, d / 5, hingeRadius * 0.65);
      // The paper has square corners. Keep its exposed edges inside the rounded
      // plastic silhouette, while the spine edge still wraps onto both folds.
      const sleeve = !jewel && !cardboard;
      const paperMargin = profile.id==='genesis'?4.6:sleeve ? openingRadius + Math.min(.35, openingRadius / 4) : 0;
      const paperLip = profile.id==='genesis'?4.6:sleeve ? Math.min(1.8, w / 16, h / 16) : 0;
      const paperHeader = profile.headerHeight || 0;
      const atlas = globalThis.OpenCabinetImages || globalThis.window?.OpenCabinetImages;
      const fullCover = !rejectedFullCover && atlas?.wrapRegions && images.find(image => image.kind === "box_full" && image.path);
      if (fullCover) model.dataset.fullCover = "loading"; else delete model.dataset.fullCover;
      const paperSize = { width: topSpine ? w-paperMargin*2 : w-paperLip, height: h-paperMargin*2-paperHeader, depth:d };
      paperLayout = paperSize;
      const wrapSurfaces = [];
      const applyAtlas = (url, width, height, state) => {
        const axis = width >= height ? "x" : "y";
        for (const [source, region] of Object.entries(atlas.wrapRegions(paperSize, axis))) {
          model.style.setProperty(`--box-texture-${source}`, `url(${JSON.stringify(url)})`);
          model.style.setProperty(`--box-texture-size-${source}`, region.size);
          model.style.setProperty(`--box-texture-position-${source}`, region.position);
          model.style.setProperty(`--box-paper-${source}`, '#f4f1e9');
        }
        model.dataset.fullCover = state;
        wrapSurfaces.forEach(show => show(axis));
        schedule();
      };
      model.dataset.spineFace = profile.spineFace;
      model.style.setProperty("--box-fold-radius", `${foldRadius}px`);
      // TL, TR, BR, BL as seen from the front. Back artwork mirrors left/right.
      cornerRadii = profile.spineFace === "top"
        ? [hingeRadius, hingeRadius, openingRadius, openingRadius]
        : [hingeRadius, openingRadius, openingRadius, hingeRadius];
      if(profile.variant==='ps3')cornerRadii[0]=openingRadius;
      const addCaseSeam = (face, axis, position = "50%") => {
        face.dataset.seam = axis;
        const seam = document.createElement("span"); seam.className = "game-box-case-seam";
        seam.style.setProperty("--box-seam-position", position);
        face.appendChild(seam);
      };
      let coverFinished = !fullCover && !images.some(image => image.kind === "cover");
      const secondaryTextures = [];
      const releaseSecondary = () => {
        if (disposed || token !== revision) return;
        coverFinished = true; secondaryTextures.splice(0).forEach(start => start());
      };
      const definitions = [
        ["front", w,h, s => `translateZ(${d*s/2}px)`, [0,0,1], "cover"],
        ["back", w,h, s => `rotateY(180deg) translateZ(${d*s/2}px)`, [0,0,-1], "back_cover"],
        ["left", d,h, s => `rotateY(-90deg) translateZ(${w*s/2}px)`, [-1,0,0], !topSpine ? "spine" : null],
        ["right", d,profile.id==='genesis'?h-14:h, s => `rotateY(90deg) translateZ(${w*s/2}px)`, [1,0,0], jewel && !topSpine ? "spine" : null],
        ["top", profile.id==='genesis'?w-5.8:jewel&&profile.id!=='longbox'?w-hingeWidth:w,d,
          s => `translateX(${(profile.id==='genesis'?-2.9:jewel&&profile.id!=='longbox'?hingeWidth/2:0)*s}px) rotateX(90deg) translateZ(${h*s/2}px)`, [0,-1,0], topSpine ? "spine" : null],
        ["bottom", profile.id==='genesis'?w-5.8:jewel&&profile.id!=='longbox'?w-hingeWidth:w,d,
          s => `translateX(${(profile.id==='genesis'?-2.9:jewel&&profile.id!=='longbox'?hingeWidth/2:0)*s}px) rotateX(-90deg) translateZ(${h*s/2}px)`, [0,1,0], jewel && topSpine ? "spine" : null],
      ];
      definitions.forEach(([name, width, height, transform, normal, kind]) => {
        const face = document.createElement("div"); face.className = `game-box-face game-box-${name}`;
        face.dataset.face = name;
        if(profile.id==='genesis') {
          // These planes already end at the recessed body's curve tangencies.
          // Applying the generic rounded-shell crop again separates the joins.
          if(name==='right')face.style.clipPath='none';
          if(['top','bottom'].includes(name))face.style.clipPath='inset(0 0 0 var(--box-corner-'+(name==='top'?'tl':'bl')+'))';
        }
        // Overlap adjacent edges by a fraction of a display pixel so independent
        // GPU layers cannot expose hairline cracks while rotating or zooming.
        const recess=paperHeader&&['front','back'].includes(name) ? .45 : 0;
        const inset=profile.id==='genesis' ? name==='right'?2.6:['top','bottom'].includes(name)?3.8:recess : recess;
        const surfaceTransform = (scale) => `${transform(scale)}${inset?' translateZ('+(-inset*scale)+'px)':''} scale(${1 + 1 / (width * scale)}, ${1 + 1 / (height * scale)})`;
        Object.assign(face.style, { width: `${width}px`, height: `${height}px`, left: `${-width/2}px`, top: `${-height/2}px`, transform: surfaceTransform(1) });
        const fallback = document.createElement("span"); fallback.className = "game-box-fallback";
        fallback.textContent = kind || ["front", "back", "left"].includes(name) ? game.title : "";
        face.appendChild(fallback);
        const individual = kind && images.find((image) => image.kind === kind);
        const wrapped = fullCover && ["cover","back_cover","spine"].includes(kind);
        const artwork = wrapped ? fullCover : individual;
        if (artwork) {
          const image = document.createElement("img");
          image.alt = ""; image.draggable = false; image.decoding = "async"; image.loading = "eager";
          image.fetchPriority = kind === "cover" ? "high" : "low";
          let artWidth = width, artHeight = height, artX = 0, artY = 0;
          if (jewel) {
            if (name === "front") {
              const padding = 1.3;
              artX = (topSpine ? 0 : hingeWidth) + padding;
              artY = (topSpine ? hingeWidth : 0) + padding;
              artWidth = w - (topSpine ? 0 : hingeWidth) - padding * 2;
              artHeight = h - (topSpine ? hingeWidth : 0) - padding * 2;
              image.style.objectFit = "contain";
            } else if (["left", "right"].includes(name)) {
              artWidth -= lidThickness;
              if (name === "right") artX = lidThickness;
            } else if (["top", "bottom"].includes(name)) {
              artHeight -= lidThickness;
              if (name === "bottom") artY = lidThickness;
            }
            Object.assign(image.style, { left: `${artX/width*100}%`, top: `${artY/height*100}%`, width: `${artWidth/width*100}%`, height: `${artHeight/height*100}%` });
          } else if (sleeve) {
            if (topSpine) {
              artX = paperMargin; artWidth -= paperMargin * 2;
              if (["front", "back"].includes(name)) artHeight -= paperLip;
            } else {
              artY = paperMargin + paperHeader; artHeight -= paperMargin * 2 + paperHeader;
              if (["front", "back"].includes(name)) {
                artWidth -= paperLip; if (name === "back") artX = paperLip;
              }
            }
            Object.assign(image.style, { left: `${artX/width*100}%`, top: `${artY/height*100}%`, width: `${artWidth/width*100}%`, height: `${artHeight/height*100}%`, borderRadius: "0" });
          }
          // Each printed sheet owns its back. Do not infer an entire white
          // spine from a cover, or fill the unprinted margins with white paper.
          let paper=null;
          if(!cardboard && dvd?.canOpen(profile)) {
            paper=document.createElement('div');paper.className='game-box-face game-box-dvd-cover-paper'+(kind==='spine'?' spine-paper':'');
            paper.dataset.paperFace=name;paper.dataset.casePart=name==='front'?'lid':name==='left'&&!jewel?'spine':'tray';
            const x=artX+artWidth/2-width/2,y=artY+artHeight/2-height/2;
            faces.push({element:paper,normal:normal.map(value=>-value),width:artWidth,height:artHeight,
              interior:true,lighting:'paper',part:paper.dataset.casePart,paperOrigin:[x,y],
              transform:s=>`${transform(s)} translate3d(${x*s}px,${y*s}px,${(-inset-.08)*s}px) rotateY(180deg)`});
            model.appendChild(paper);
          }
          let wrapLayer = null;
          if (wrapped) {
            wrapLayer = document.createElement("div"); wrapLayer.className = "game-box-wrap-texture";
            wrapLayer.dataset.source = kind;
            Object.assign(wrapLayer.style, { left:`${artX/width*100}%`, top:`${artY/height*100}%`, width:`${artWidth/width*100}%`, height:`${artHeight/height*100}%`,
              backgroundImage:`var(--box-texture-${kind}, none)`, backgroundSize:`var(--box-texture-size-${kind}, 100% 100%)`, backgroundPosition:`var(--box-texture-position-${kind}, 0% 0%)` });
            image.className = "game-box-wrap-source";
          }
          let preview = null;
          const removePreview = () => {
            if (!preview) return;
            preview.remove(); preview.width = preview.height = 0;
            previews = previews.filter(canvas => canvas !== preview); preview = null;
          };
          if (kind === "cover") {
            try {
              const bitmap = getCoverPreview(wrapped ? individual?.path : artwork.path);
              if (bitmap?.width && bitmap.height) {
                preview = document.createElement("canvas"); preview.className = "game-box-cover-preview";
                preview.width = bitmap.width; preview.height = bitmap.height;
                preview.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0);
                for (const property of ["left", "top", "width", "height", "objectFit", "borderRadius"]) {
                  if (image.style[property]) preview.style[property] = image.style[property];
                }
                previews.push(preview); fallback.hidden = true;model.style.setProperty(`--box-paper-${kind}`,'#f4f1e9');
              }
            } catch { if (preview) preview.width = preview.height = 0; preview = null; }
          }
          if (wrapped) wrapSurfaces.push(axis => {
            if (kind === "spine" && (axis === "y") !== (artWidth > artHeight)) {
              Object.assign(wrapLayer.style, { width:`${artHeight/width*100}%`, height:`${artWidth/height*100}%`, left:`${(artX+artWidth/2)/width*100}%`, top:`${(artY+artHeight/2)/height*100}%`, transform:"translate(-50%, -50%) rotate(90deg)" });
              model.dataset.spineRotated = "true";
            }
            wrapLayer.classList.add("loaded"); fallback.hidden = true;
            if (paper) paper.style.visibility = '';
            removePreview();
          });
          const reveal = () => {
            if (disposed || token !== revision) return;
            const atlasAxis = image.naturalWidth >= image.naturalHeight ? "x" : "y";
            if (wrapped) {
              applyAtlas(image.src, image.naturalWidth, image.naturalHeight, "ready");
              if (fullPreviewUrl) URL.revokeObjectURL(fullPreviewUrl);
              fullPreviewUrl = null;
            }
            if(paper)paper.style.visibility='';
            model.style.setProperty(`--box-paper-${kind}`,'#f4f1e9');
            if (kind === "cover" && dreamcast) {
              // A tiny decoded sample chooses the light/dark Dreamcast spine
              // insert. A cross-origin image can refuse sampling; keep the
              // regional fallback in that case, without another image request.
              try {
                const sample=document.createElement("canvas");sample.width=sample.height=2;
                const context=sample.getContext("2d",{willReadFrequently:true});
                context.drawImage(image,0,0,Math.max(1,image.naturalWidth*.08),Math.max(1,image.naturalHeight*.08),0,0,2,2);
                const pixels=context.getImageData(0,0,2,2).data;
                let light=0;for(let i=0;i<pixels.length;i+=4)light+=pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722;
                model.dataset.spineLabelTone=light/4<120?"dark":"light";
                sample.width=sample.height=0;
              } catch { /* Keep the regional paper tone. */ }
            }
            if (kind === "cover") {
              const aspect = !wrapped ? image.naturalWidth / image.naturalHeight : atlasAxis === "x"
                ? Math.max(.1,(image.naturalWidth/image.naturalHeight - d/paperSize.height)/2)
                : 2 / Math.max(.1,image.naturalHeight/image.naturalWidth - d/paperSize.width);
              const next = profileFor(game.platform, aspect, game.rom_path, settings);
              if (next.id !== profile.id || Math.abs(next.width - profile.width) > 0.1) { profile = next; rebuild(); return; }
            }
            if (!wrapped && kind === "spine" && (image.naturalWidth > image.naturalHeight) !== (artWidth > artHeight)) {
              // Percentages keep rotated spines fitted when fullscreen/zoom
              // changes the face geometry without replacing the loaded image.
              Object.assign(image.style, { width: `${artHeight/width*100}%`, height: `${artWidth/height*100}%`, left: `${(artX+artWidth/2)/width*100}%`, top: `${(artY+artHeight/2)/height*100}%`, transform: "translate(-50%, -50%) rotate(90deg)" });
              model.dataset.spineRotated = "true";
            }
            model.style.setProperty(`--box-texture-${kind}`, `url(${JSON.stringify(image.src)})`);
            image.classList.add("loaded"); fallback.hidden = true;
            removePreview();
            if (kind === "cover") releaseSecondary();
          };
          const failed = () => {
            if (token !== revision || disposed) return;
            if (wrapped) { rejectedFullCover = true; rebuild(); return; }
            if(paper&&!preview)paper.style.visibility='hidden';
            if(!preview)model.style.setProperty(`--box-paper-${kind}`,'var(--box-material)');
            image.removeAttribute("src"); if (kind === "cover") releaseSecondary();
          };
          image.onload = () => {
            if (disposed || token !== revision) return;
            if (image.decode) image.decode().then(reveal, failed);
            else reveal();
          };
          image.onerror = failed;
          textures.push(image); face.appendChild(image);
          if (wrapLayer) face.appendChild(wrapLayer);
          if (preview) face.appendChild(preview);
          const start = () => { if (!disposed && token === revision) image.src = imageSource(artwork.path); };
          if (kind === "cover" || coverFinished) start(); else secondaryTextures.push(start);
        }
        const spineFace = profile.spineFace === "top" ? "top" : "left";
        if (!cardboard && ["left", "right", "top", "bottom"].includes(name) && (jewel || name !== spineFace)) {
          const position = jewel ? `${["right", "bottom"].includes(name) ? lidShare : 100 - lidShare}%` : "50%";
          addCaseSeam(face, ["left", "right"].includes(name) ? "vertical" : "horizontal", position);
        }
        if (paperHeader && name === "front") {
          const header=document.createElement("span");header.className="game-box-bluray-header";
          const symbol=document.createElement('span');symbol.className='game-box-bluray-mark';
          header.title='Blu-ray Disc';header.appendChild(symbol);
          const plate=document.createElement('div');plate.className='game-box-face game-box-ps3-header-plate';plate.appendChild(header);
          faces.push({element:plate,normal:[0,0,1],width:w,height:paperHeader,part:'lid',transform:s=>`translate3d(0,${(-h/2+paperHeader/2)*s}px,${(d/2+.08)*s}px)`});model.appendChild(plate);
        }
        const openingFace = profile.spineFace === "top" ? "bottom" : "right";
        if (!cardboard && name === openingFace) {
          face.dataset.opening = name === "right" ? "vertical" : "horizontal";
          const grip = document.createElement("span"); grip.className = "game-box-opening-detail";
          const span = name === "right" ? h : w;
          const channel = dvd?.openingChannel(profile);
          if (channel) {
            grip.dataset.recess = "keep-case";
            grip.style.setProperty("--box-grip-long", `${span * channel.length}px`);
            grip.style.setProperty("--box-grip-short", `${d * channel.width}px`);
            grip.style.setProperty("--box-grip-radius", `${Math.min(channel.radius, d * 0.15)}px`);
          }
          face.appendChild(grip);
        }
        faces.push({ element: face, normal, width, height, transform: surfaceTransform }); model.appendChild(face);
      });
      if (jewel) {
        model.dataset.spineLabelTone = region === "japan" ? "light" : "dark";
        const inset=document.createElement("div");inset.className="game-box-face game-box-jewel-inset";
        if(dreamcast){const logo=document.createElement("span");logo.className="game-box-dreamcast-mark";logo.textContent="Dreamcast";inset.appendChild(logo);}
        faces.push({element:inset,normal:[0,0,1],width:topSpine?w:hingeWidth,height:topSpine?hingeWidth:h,
          part:"tray",transform:s=>`translate3d(${topSpine?0:(-w/2+hingeWidth/2)*s}px,${topSpine?(-h/2+hingeWidth/2)*s:0}px,${(profile.id==='longbox'?d/2+.05:-d/2+.32)*s}px)`});
        model.appendChild(inset);
        const element = document.createElement("div"); element.className = "game-box-face game-box-acrylic-lid";
        const width=w-(topSpine?0:hingeWidth),height=h-(topSpine?hingeWidth:0);
        const transform = s => `translate3d(${topSpine?0:hingeWidth*s/2}px,${topSpine?hingeWidth*s/2:0}px,${(d/2+.12)*s}px)`;
        element.style.backfaceVisibility='visible';
        faces.push({ element, normal: [0,0,1], width, height, part:"lid", transform }); model.appendChild(element);
        {
          // A full-depth fixed column, from the rear shell to the front lid.
          // Jewel cases expose the insert at its bottom through clear acrylic;
          // longboxes have the exposed grille on top and an opaque inner wall.
          const capW=topSpine?w:hingeWidth,capH=topSpine?hingeWidth:h;
          const x=topSpine?0:-w/2+hingeWidth/2,y=topSpine?-h/2+hingeWidth/2:0;
          const depth=d+.05,centerZ=.025;
          const rail=(normal,width,height,orientation,xx=x,yy=y,zz=d/2+.05)=> {
            const element=document.createElement('div');element.className='game-box-face '+(profile.id==='longbox'?'game-box-hinge-block':'game-box-hinge-acrylic');element.style.backfaceVisibility='visible';
            faces.push({element,normal,width,height,part:'tray',transform:s=>`translate3d(${xx*s}px,${yy*s}px,${zz*s}px) ${orientation}`});model.appendChild(element);
          };
          if(profile.id!=='longbox')rail([0,0,1],capW,capH,'');
          for(const sign of [-1,1]){
            // The outer side carries the existing printed spine. Leave that
            // paper visible while placing the acrylic just inside its plane.
            rail([sign,0,0],depth,capH,'rotateY('+(sign*90)+'deg)',x+sign*(capW/2-.06),y,centerZ);
            rail([0,sign,0],capW,depth,'rotateX('+(-sign*90)+'deg)',x,y+sign*capH/2,centerZ);
          }
          // Full-depth ears wrap the fixed column from above and below. They
          // exist while closed too, with a smooth finish on PS1/Dreamcast.
          for(const sy of [-1,1]) {
            const ww=hingeWidth+1.4,hh=.8,dd=d+.12,cx=-w/2+hingeWidth/2+.7,cy=sy*(h/2+.8),cz=.06;
            const ear=(width,height,x,y,z,normal,orientation)=> {
              const element=document.createElement('div');element.className='game-box-face game-box-jewel-hinge-ear';element.style.backgroundColor='var(--box-shell)';
              faces.push({element,normal,width,height,part:'lid',transform:s=>`translate3d(${x*s}px,${y*s}px,${z*s}px) ${orientation}`});model.appendChild(element);
            };
            ear(ww,hh,cx,cy,cz+dd/2,[0,0,1],'');ear(ww,hh,cx,cy,cz-dd/2,[0,0,-1],'rotateY(180deg)');
            for(const side of [-1,1]) {
              ear(dd,hh,cx+side*ww/2,cy,cz,[side,0,0],'rotateY('+(side*90)+'deg)');
              ear(ww,dd,cx,cy+side*hh/2,cz,[0,side,0],'rotateX('+(-side*90)+'deg)');
            }
          }
        }
      }
      if(profile.id==="genesis") {
        // The spine projects past the recessed opening too. Give its full
        // height an inward-facing skin, including the unprinted end margins.
        const spineInner=document.createElement('div');spineInner.className='game-box-face game-box-genesis-spine-inner';
        faces.push({element:spineInner,normal:[1,0,0],width:d,height:h,part:'spine',
          transform:s=>`translateX(${(-w/2+.12)*s}px) rotateY(90deg)`});model.appendChild(spineInner);
        for(const [part,sign] of [["lid",1],["tray",-1]]){
          const element=document.createElement("div");element.className="game-box-face game-box-grab-lip";
          element.style.backfaceVisibility='visible';
          // A continuous thin U-shaped flange, not an isolated side strip.
          // It follows the front/back silhouette on top, opening side and base.
          const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'"><rect width="100%" height="100%" rx=".65" fill="white"/><rect x="'+(sign<0?4.6:-1)+'" y="4.6" width="'+(w-3.6)+'" height="'+(h-9.2)+'" rx=".25" fill="black"/></svg>';
          element.style.maskImage='url("data:image/svg+xml,'+encodeURIComponent(svg)+'")';element.style.maskMode='luminance';element.style.maskSize='100% 100%';
          faces.push({element,normal:[0,0,sign],width:w,height:h,part,
            transform:s=>`translateZ(${sign*(d/2+.1)*s}px)${sign<0?" rotateY(180deg)":""}`});
          model.appendChild(element);
          const inner=document.createElement('div');inner.className='game-box-face game-box-grab-lip game-box-grab-lip-inner';
          const innerSvg=svg.replace('x="'+(sign<0?4.6:-1)+'" y="4.6"','x="'+(sign>0?4.6:-1)+'" y="4.6"');
          inner.style.maskImage='url("data:image/svg+xml,'+encodeURIComponent(innerSvg)+'")';inner.style.maskMode='luminance';inner.style.maskSize='100% 100%';
          faces.push({element:inner,normal:[0,0,-sign],width:w,height:h,part,transform:s=>`translateZ(${sign*(d/2+.06)*s}px)${sign>0?' rotateY(180deg)':''}`});model.appendChild(inner);
        }
      }
      if(profile.variant==='ps3') {
        // The raised rounded header continues down the spine to the beginning
        // of the printed sleeve; it is not just a rounded front-face corner.
        const top=-h/2+openingRadius,bottom=-h/2+paperHeader+paperMargin,cy=(top+bottom)/2,hh=bottom-top;
        const add=(width,height,x,y,z,normal,orientation)=>{
          const element=document.createElement('div');element.className='game-box-face game-box-ps3-spine-collar';element.style.backfaceVisibility='visible';
          faces.push({element,normal,width,height,part:'spine',transform:s=>`translate3d(${x*s}px,${y*s}px,${z*s}px) ${orientation}`});model.appendChild(element);
        };
        add(d+.16,hh,-w/2-.35,cy,0,[-1,0,0],'rotateY(-90deg)');
        for(const sign of [-1,1])add(.35,hh,-w/2-.175,cy,sign*(d/2+.08),[0,0,sign],sign<0?'rotateY(180deg)':'');
        for(const [y,sign] of [[top,-1],[bottom,1]])add(.35,d+.16,-w/2-.175,y,0,[0,sign,0],'rotateX('+(-sign*90)+'deg)');
      }
      // Rounded front/back silhouettes need actual curved side walls too. Merely
      // clipping six rectangles leaves holes or square caps visible when rotated.
      const corners = document.createElement("div"); corners.className = "game-box-corners";
      const centers = [
        [-w/2 + cornerRadii[0], -h/2 + cornerRadii[0], 180],
        [w/2 - cornerRadii[1], -h/2 + cornerRadii[1], 270],
        [w/2 - cornerRadii[2], h/2 - cornerRadii[2], 0],
        [-w/2 + cornerRadii[3], h/2 - cornerRadii[3], 90],
      ];
      const segments = 24, step = Math.PI / (2 * segments);
      centers.forEach(([cx, cy, start], corner) => {
        if (!cornerRadii[corner]) return;
        const radius = cornerRadii[corner], width = 2 * radius * Math.sin(step / 2);
        for (let part = 0; part < segments; part++) {
          const degrees = start + (part + 0.5) * 90 / segments, angle = degrees * Math.PI / 180;
          const nx = Math.cos(angle), ny = Math.sin(angle);
          const x = cx + radius * Math.cos(step / 2) * nx, y = cy + radius * Math.cos(step / 2) * ny;
          for(const sign of profile.id==='genesis'?[-1,1]:[0]) {
          const depth=sign ? .65 : d,z=sign*(d/2-.225);
          const element = document.createElement("div"); element.className = "game-box-face game-box-corner";
          element.dataset.curve = "x";
          if (!cardboard&&!sign) addCaseSeam(element, "horizontal", jewel ? `${100-lidShare}%` : "50%");
          const transform = (scale) => `translate3d(${x*scale}px, ${y*scale}px, ${z?z*scale+'px':'0'}) rotateZ(${degrees+90}deg) rotateX(90deg) scale(${1 + 0.12 / (width*scale)}, ${1 + (sign ? .12 : 1) / (depth*scale)})`;
          const normals = [-.5, .5].map(offset => {
            const a = angle + offset * step; return [Math.cos(a), Math.sin(a), 0];
          });
          faces.push({ element, normal: [nx, ny, 0], width, height: depth, transform, curve: { normals } });
          corners.appendChild(element);
          }
        }
      });
      model.appendChild(corners);
      if(profile.id==='genesis') {
        // Rounded joins on the recessed opening belong to the body, distinct
        // from the thin outer flange. Their endpoints match the cropped sides.
        const r=3.2,segments=24,step=Math.PI/(2*segments),cx=w/2-2.6-r;
        for(const [cy,start] of [[-h/2+3.8+r,270],[h/2-3.8-r,0]])for(let i=0;i<segments;i++) {
          const a=(start+(i+.5)*90/segments)*Math.PI/180;
          const element=document.createElement('div');element.className='game-box-face game-box-genesis-opening-curve';element.dataset.curve='x';
          addCaseSeam(element,'horizontal','50%');
          const width=2*r*Math.sin(step/2),normals=[-.5,.5].map(offset=>[Math.cos(a+offset*step),Math.sin(a+offset*step),0]);
          faces.push({element,width,height:d,normal:[Math.cos(a),Math.sin(a),0],curve:{normals},
            transform:s=>`translate3d(${(cx+r*Math.cos(step/2)*Math.cos(a))*s}px,${(cy+r*Math.cos(step/2)*Math.sin(a))*s}px,0) rotateZ(${a*180/Math.PI+90}deg) rotateX(90deg)`});model.appendChild(element);
        }
      }
      // Two quarter-cylinder folds join the artwork tangentially to the spine.
      // Project edge strips of the original images onto them; no extra image
      // requests or downscaled copies are needed, including rotated spine art.
      const folds = document.createElement("div"); folds.className = "game-box-folds";
      const start = topSpine ? -w/2 + (paperMargin || cornerRadii[0]) : -h/2 + (paperMargin || cornerRadii[0]) + paperHeader;
      const end = topSpine ? w/2 - (paperMargin || cornerRadii[1]) : h/2 - (paperMargin || cornerRadii[3]);
      const length = end - start, midpoint = (start + end) / 2;
      const foldParts = 16, angleStep = Math.PI / (2 * foldParts);
      for (const back of jewel || cardboard ? [] : [false, true]) {
        const sign = back ? -1 : 1;
        for (let part = 0; part < foldParts; part++) {
          const angle = (part + 0.5) * angleStep, degrees = angle * 180 / Math.PI;
          const edge = foldRadius * Math.cos(angleStep / 2);
          const across = (topSpine ? -h/2 : -w/2) + foldRadius - edge * Math.sin(angle);
          const z = sign * (d/2 - foldRadius + edge * Math.cos(angle));
          const breadth = 2 * foldRadius * Math.sin(angleStep / 2);
          const fromSpine = part >= foldParts / 2;
          const source = fromSpine ? "spine" : back ? "back_cover" : "cover";
          const fraction = fromSpine ? (part - foldParts/2 + 0.5) / (foldParts/2) : (part + 0.5) / (foldParts/2);
          const sourceWidth = topSpine ? w - paperMargin * 2 : fromSpine ? d : w - paperLip;
          const sourceHeight = topSpine ? (fromSpine ? d : h - paperLip) : h - paperMargin * 2 - paperHeader;
          const u = topSpine ? (back && !fromSpine ? sourceWidth/2 - midpoint : sourceWidth/2 + midpoint)
            : fromSpine ? (back ? foldRadius * fraction : d - foldRadius * fraction)
            : back ? sourceWidth - foldRadius * (1 - fraction) : foldRadius * (1 - fraction);
          const v = topSpine ? (fromSpine ? (back ? foldRadius * fraction : d - foldRadius * fraction) : foldRadius * (1 - fraction)) : sourceHeight/2 + midpoint - paperHeader/2;
          const width = topSpine ? length : breadth, height = topSpine ? breadth : length;
          const factor = breadth / (foldRadius / (foldParts/2));
          const element = document.createElement("div"); element.className = "game-box-face game-box-fold";
          element.dataset.curve = topSpine ? "y" : "x";
          element.dataset.source = source; element.dataset.join = back ? "back" : "front";
          const art = document.createElement("div"); art.className = "game-box-fold-art";
          const ink = document.createElement("div"); ink.className = "game-box-fold-ink";
          ink.style.backgroundImage = `var(--box-texture-${source}, none)`;
          ink.style.backgroundSize = `var(--box-texture-size-${source}, 100% 100%)`;
          ink.style.backgroundPosition = `var(--box-texture-position-${source}, 0% 0%)`;
          ink.style.setProperty("--box-art-ratio", String(sourceHeight / sourceWidth));
          art.appendChild(ink); element.appendChild(art);
          const normal = topSpine ? [0, -Math.sin(angle), sign * Math.cos(angle)] : [-Math.sin(angle), 0, sign * Math.cos(angle)];
          const order = back && !(topSpine && !fromSpine) ? 1 : -1;
          const normals = [-.5, .5].map(offset => {
            const a = angle + offset * angleStep * order;
            return topSpine ? [0, -Math.sin(a), sign * Math.cos(a)] : [-Math.sin(a), 0, sign * Math.cos(a)];
          });
          const transform = (scale) => topSpine
            ? `translate3d(${midpoint*scale}px, ${across*scale}px, ${z*scale}px) rotateX(${back ? 180-degrees : degrees}deg)${back && !fromSpine ? " rotateZ(180deg)" : ""} scale(${1+1/(width*scale)}, ${1+0.08/(height*scale)})`
            : `translate3d(${across*scale}px, ${midpoint*scale}px, ${z*scale}px) rotateY(${back ? 180+degrees : -degrees}deg) scale(${1+0.08/(width*scale)}, ${1+1/(height*scale)})`;
          const assembly=back?'tray':'lid';
          faces.push({ element, normal, width, height, transform, curve: { normals },part:assembly,
            texture: { art, width: sourceWidth, height: sourceHeight, u, v, sx: topSpine ? 1 : factor, sy: topSpine ? factor : 1 } });
          folds.appendChild(element);
          const lining=document.createElement('div');lining.className='game-box-face game-box-fold-lining';
          lining.style.backgroundColor=`var(--box-paper-${source},var(--box-material))`;lining.dataset.paperSource=source;
          faces.push({element:lining,normal:normal.map(n=>-n),width,height,part:assembly,interior:true,lighting:'paper',
            transform:s=>`${transform(s)} translateZ(${-0.04*s}px) rotateY(180deg)`});model.appendChild(lining);
        }
        // The very short ends stop under the existing molded top/bottom rims.
        // Material caps close those cuts without disturbing the rounded corners.
        for (const [position, direction] of [[start, 1], [end, -1]]) {
          const element = document.createElement("div"); element.className = "game-box-face game-box-fold-cap";
          const across = (topSpine ? -h/2 : -w/2) + foldRadius/2, z = sign * (d/2 - foldRadius/2);
          const transform = (scale) => topSpine
            ? `translate3d(${position*scale}px, ${across*scale}px, ${z*scale}px) rotateY(${direction*90}deg)`
            : `translate3d(${across*scale}px, ${position*scale}px, ${z*scale}px) rotateX(${-direction*90}deg)`;
          element.style.backfaceVisibility='visible';
          faces.push({ element, normal: topSpine ? [direction, 0, 0] : [0, direction, 0], width: foldRadius, height: foldRadius, transform,part:back?'tray':'lid' });
          folds.appendChild(element);
        }
      }
      model.appendChild(folds);
      if (dvd?.canOpen(profile)) {
        parts = {};
        for (const part of ["tray", "spine", "lid"]) {
          const element = document.createElement("div"); element.className = "game-box-part";
          element.dataset.part = part; parts[part] = element; model.appendChild(element);
        }
        faces.forEach(face => {
          const name = face.element.dataset.face;
          face.part ||= name === "front" ? "lid" : name === "left" ? (jewel?"tray":"spine") : "tray";
          face.closedOnly = !(jewel?["front","back","left","right"]:["front","back","left"]).includes(name) && !face.element.className.includes("acrylic-lid") && !face.element.className.includes("hinge-acrylic") && !face.element.className.includes("jewel-inset") && !face.element.className.includes("grab-lip") && !face.element.className.includes('ps3-header-plate');
          if(face.interior||face.texture||face.element.className.includes('game-box-fold-cap')||face.element.className.includes('hinge-block')||face.element.className.includes('jewel-hinge-ear')||face.element.className.includes('ps3-spine-collar')||face.element.className.includes('genesis-spine-inner'))face.closedOnly=false;
          if (!face.closedOnly) parts[face.part].appendChild(face.element);
        });
        if (openTarget || opened > 0) ensureInterior();
      }
      if (fullCover) {
        const showPreview = bitmap => {
          if (disposed || token !== revision || model.dataset.fullCover === "ready" || !bitmap?.previewBlob) return;
          if (fullPreviewUrl) URL.revokeObjectURL(fullPreviewUrl);
          fullPreviewUrl = URL.createObjectURL(bitmap.previewBlob);
          const size = bitmap.previewSize || bitmap;
          applyAtlas(fullPreviewUrl, size.width, size.height, "preview");
        };
        const cached = getCoverPreview(fullCover.path);
        if (cached?.previewBlob) showPreview(cached);
        else if (loadCoverPreview) {
          fullPreviewController = new AbortController();
          Promise.resolve(loadCoverPreview(fullCover.path, fullPreviewController.signal)).then(showPreview).catch(() => {});
        }
      }
      notifyOpening();
      schedule();
      ensureManual();
    }
    function stopDrag(event) {
      if (!drag || (event && event.pointerId !== drag.id)) return;
      const { id, manual, moved } = drag; drag = null; host.classList.remove("dragging");
      if (host.hasPointerCapture(id)) host.releasePointerCapture(id);
      if (event?.type === "pointerup" && manual && !moved) api.readManual(manual);
    }
    function point(event, rect) {
      const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.48);
      let x = (event.clientX - rect.left - rect.width/2) / radius;
      let y = (event.clientY - rect.top - rect.height/2) / radius;
      const length = x*x+y*y;
      if (length > 1) { const s = Math.sqrt(length); x /= s; y /= s; }
      return [x, y, Math.sqrt(Math.max(0, 1-x*x-y*y))];
    }
    listen("pointerdown", (event) => {
      if (event.button !== 0 || drag || !game || inMenu(event.target)) return;
      event.preventDefault(); host.focus({ preventScroll: true });
      const rect = host.getBoundingClientRect();
      const manual = opened === 1 && model.dataset.manualExtracted !== "true" && event.target?.closest?.('[data-manual-booklet="true"]');
      drag = { id: event.pointerId, rect, point: point(event, rect), manual, moved: false, x: event.clientX, y: event.clientY };
      host.setPointerCapture(event.pointerId); host.classList.add("dragging");
    });
    listen("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6;
      if (drag.manual && !drag.moved) return;
      const next = point(event, drag.rect);
      if (rotationLock !== "free") {
        const degrees = rotationLock === "x" ? (event.clientX - drag.x) * 180 / drag.rect.width
          : -(event.clientY - drag.y) * 180 / drag.rect.height;
        if (degrees) { rotation = multiply(axisAngle(rotationLock === "x" ? [0,1,0] : [1,0,0], degrees), rotation); viewSide = null; schedule(); }
        drag.x = event.clientX; drag.y = event.clientY; drag.point = next; return;
      }
      if (next.some((value, index) => Math.abs(value - drag.point[index]) > 1e-6)) viewSide = null;
      rotation = multiply(between(drag.point, next), rotation); drag.point = next; schedule();
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((name) => listen(name, stopDrag));
    listen("dragstart", (event) => event.preventDefault());
    listen("wheel", (event) => {
      if (!game || !Number.isFinite(event.deltaY) || !event.deltaY) return;
      if (inMenu(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.getBoundingClientRect().height : 1);
      api.zoom(-Math.max(-200, Math.min(200, pixels)) * .001);
    }, { passive: false });
    listen("keydown", (event) => {
      if (event.key.toLowerCase() === "m" && !event.ctrlKey && !event.metaKey && !event.altKey && api.readManual()) {
        event.preventDefault(); event.stopPropagation(); return;
      }
      const openKey = event.key.toLowerCase() === "o" && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (openKey) {
        if (dvd?.canOpen(profile)) { event.preventDefault(); event.stopPropagation(); api.toggleOpen(); }
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "+", "=", "-"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Home") api.reset();
      else if (["+", "=", "-"].includes(event.key)) api.zoom(event.key === "-" ? -0.15 : 0.15);
      else {
        const horizontal = ["ArrowLeft", "ArrowRight"].includes(event.key);
        if (rotationLock === (horizontal ? "y" : "x")) return;
        viewSide = null;
        rotation = multiply(axisAngle(horizontal ? [0,1,0] : [1,0,0], ["ArrowLeft", "ArrowUp"].includes(event.key) ? -15 : 15), rotation);
        schedule();
      }
    });
    const observer = new ResizeObserver(() => { viewport = null; closeMenu(); schedule(); }); observer.observe(host);
    const api = {
      update(nextGame, nextImages, nextSettings = null) {
        nextSettings = resolveSettings(nextSettings, nextGame.box_3d);
        const fallbacks = globalThis.OpenCabinetImages || globalThis.window?.OpenCabinetImages;
        if (fallbacks) nextImages = fallbacks.resolve(nextImages);
        const nextKey = JSON.stringify([nextGame.id, nextGame.title, nextGame.platform, nextGame.rom_path,
          nextImages.filter((image) => ["box_full", "cover", "back_cover", "inlay", "spine", "disc", "cart_front", "cart_back", "cart_label"].includes(image.kind)), nextSettings]);
        if (nextKey === key || disposed) return;
        closeMenu();
        if (game?.id !== nextGame.id) { rotation = initialRotation(); viewSide = "front"; zoom = 1; opened = 0; openTarget = false; opening = null; }
        stopDrag(); key = nextKey; game = nextGame; images = nextImages; settings = nextSettings; rejectedFullCover = false;
        host.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.c8c86a39c7", game.title));
        profile = profileFor(game.platform, null, game.rom_path, settings); rebuild();
      },
      get canOpen() { return !!dvd?.canOpen(profile); },
      get isOpen() { return openTarget; },
      get rotationLock() { return rotationLock; },
      setRotationLock(mode) {
        if (!["free", "x", "y"].includes(mode)) return;
        stopDrag(); rotationLock = mode; host.dataset.rotationLock = mode;
      },
      readManual(origin = null) {
        if (!manualData || !openTarget || disposed || model.dataset.manualExtracted === "true") return false;
        const element = origin || faces.find(face => face.element.className.endsWith("manual-front"))?.element;
        if (onManualActivate({ manual: manualData, game, origin: element }) === false) return false;
        model.dataset.manualExtracted = "true"; schedule(); return true;
      },
      returnManual() { delete model.dataset.manualExtracted; schedule(); },
      setOpen,
      toggleOpen() { return setOpen(!openTarget); },
      refreshManual() { clearManual(); layoutScale = null; ensureManual(); schedule(); },
      reset() { stopDrag(); setOpen(false, false); rotation = initialRotation(); viewSide = "front"; zoom = 1; schedule(); },
      showBack() { stopDrag(); setOpen(false, false); rotation = axisAngle([0,1,0], 180); viewSide = "back"; schedule(); },
      toggleSide() {
        const back = viewSide === "front" && !openTarget && opened === 0;
        stopDrag(); setOpen(false, false);
        rotation = back ? axisAngle([0,1,0], 180) : initialRotation();
        viewSide = back ? "back" : "front"; schedule();
      },
      zoom(delta) { zoom = Math.max(0.65, Math.min(1.7, zoom + delta)); schedule(); },
      clear() {
        closeMenu();
        stopDrag(); revision++; clearManual(); interior = null; clearTextures(); model.replaceChildren(); game = profile = key = null; faces = []; parts = null;
        images = []; opened = 0; openTarget = false; opening = null; interiorBuilt = false; notifyOpening();
      },
      dispose() {
        api.clear(); disposed = true; observer.disconnect();
        if (frame !== null) cancelAnimationFrame(frame);
        listeners.forEach(([target, name, handler, options]) => target.removeEventListener?.(name, handler, options)); host.replaceChildren();
      },
    };
    return api;
  }
  globalThis.OpenCabinet3D = { resolveSettings,
    createViewer: (host, options = {}) => globalThis.OpenCabinetThreeBoxes
      ? globalThis.OpenCabinetThreeBoxes.createRouter(host, options, createViewer, profileFor, resolveSettings)
      : createViewer(host, options), profileFor, regionFor, jewelFamily,
    formats: Object.entries(formats).map(([id, [width, height, depth, label]]) => ({ id, width, height, depth, label })),
    math: { multiply, axisAngle, between, matrix, rotate } };
})();
