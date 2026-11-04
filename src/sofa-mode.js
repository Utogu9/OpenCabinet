// A separate presentation of the library; launching still uses the shared flow.
(function (root) {
  const wrap = (index, length) => length ? ((index % length) + length) % length : 0;
  function carousel(items, selected, radius = 3) {
    const count = Math.min(items.length, radius * 2 + 1), result = [];
    const start = -Math.floor((count - 1) / 2);
    for (let offset = start; offset < start + count; offset++) {
      result.push({ item: items[wrap(selected + offset, items.length)], offset });
    }
    return result;
  }
  function platformsFor(games, platforms) {
    const byName = new Map(platforms.map(platform => [platform.name, platform]));
    const names = [...new Set(games.map(game => game.platform))].sort((a, b) => a.localeCompare(b));
    return [{ name: null, count: games.length }, ...names.map(name => ({
      ...byName.get(name), name, count: games.filter(game => game.platform === name).length,
    }))];
  }
  function rightStick(pad) {
    if (!pad || pad.connected === false || pad.mapping !== 'standard') return null;
    const x = pad.axes?.[2], y = pad.axes?.[3];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const length = Math.hypot(x, y), deadZone = .18;
    if (length <= deadZone) return null;
    const strength = Math.min(1, (length - deadZone) / (1 - deadZone));
    return [x / length * strength, y / length * strength];
  }
  function startupArtwork(games, sortGames, pathsFor, count = 9) {
    const groups = new Map();
    for (const game of games) {
      if (!groups.has(game.platform)) groups.set(game.platform, []);
      groups.get(game.platform).push(game);
    }
    const windows = [...groups].map(([platform, items]) => ({ platform, games: sortGames(items).slice(0, count) }));
    const jobs = [], seen = new Set();
    // Round-robin consoles: each gets its first cover before the next row.
    for (let i = 0; i < count; i++) for (const group of windows) {
      const game = group.games[i];
      if (game) for (const path of pathsFor(game)) {
        const key = JSON.stringify([group.platform, path]);
        if (!seen.has(key)) { seen.add(key); jobs.push({ platform: group.platform, path }); }
      }
    }
    return jobs;
  }
  function createPadInput() {
    let identity = null, held = new Set(), direction = null, nextRepeat = 0;
    return {
      reset() { identity = null; held.clear(); direction = null; },
      sample(pad, now) {
        if (!pad || pad.connected === false || pad.mapping !== 'standard') {
          identity = null; held.clear(); direction = null; return [];
        }
        const pressed = index => !!pad.buttons?.[index]?.pressed || pad.buttons?.[index]?.value > 0.6;
        const buttons = new Set([0, 1, 2, 3, 4, 5, 9, 10, 11].filter(pressed));
        const x = Number(pad.axes?.[0]) || 0, y = Number(pad.axes?.[1]) || 0;
        const movement = pressed(14) ? 'left' : pressed(15) ? 'right' : pressed(12) ? 'up' : pressed(13) ? 'down'
          : Math.abs(x) > 0.55 && Math.abs(x) >= Math.abs(y) ? (x < 0 ? 'left' : 'right')
          : Math.abs(y) > 0.55 ? (y < 0 ? 'up' : 'down') : null;
        const key = `${pad.index}:${pad.id}`;
        // Opening the mode, reconnecting or returning from a game must not
        // interpret already-held buttons as new presses.
        if (identity !== key) {
          identity = key; held = buttons; direction = movement; nextRepeat = now + 360; return [];
        }
        const actions = [];
        if (movement && (movement !== direction || now >= nextRepeat)) {
          actions.push(movement); nextRepeat = now + (movement !== direction ? 360 : 145);
        }
        direction = movement;
        const names = { 0: 'accept', 1: 'back', 2: 'view', 3: 'turn', 4: 'previousPlatform', 5: 'nextPlatform', 9: 'exit', 10:'manual', 11:'openBox' };
        for (const button of buttons) if (!held.has(button)) actions.push(names[button]);
        held = buttons;
        return actions;
      },
    };
  }

  function create(options) {
    const { document, window } = options;
    const t = (key, ...values) => root.OpenCabinetI18n.t(key, ...values);
    function element(tag, className, text) {
      const node = document.createElement(tag); if (className) node.className = className;
      if (text != null) node.textContent = text; return node;
    }
    function button(text, action, className = '') {
      const node = element('button', className, text); node.type = 'button';
      node.addEventListener('click', action); return node;
    }
    const dialog = element('dialog', 'sofa-mode'); dialog.id = 'sofa-mode';
    dialog.setAttribute('aria-labelledby', 'sofa-heading');
    const backdrop = element('div', 'sofa-backdrop'); backdrop.setAttribute('aria-hidden', 'true');
    const header = element('header', 'sofa-header');
    const brand = element('div', 'sofa-brand');
    brand.append(element('strong', '', 'OpenCabinet'));
    const heading = element('span', '', t('sofa.title')); heading.id = 'sofa-heading'; brand.append(heading);
    const tools = element('div', 'sofa-tools');
    const search = element('input', 'sofa-search'); search.id = 'sofa-search'; search.type = 'search'; search.autocomplete = 'off';
    search.placeholder = t('sofa.search'); search.setAttribute('aria-label', t('sofa.search'));
    const view = button('', () => changeView(), 'sofa-tool'); view.id = 'sofa-view';
    const exit = button(t('sofa.exit'), () => close(), 'sofa-tool'); exit.id = 'sofa-exit';
    const playlistSelect=element('select','sofa-playlist');playlistSelect.setAttribute('aria-label',t('playlists.title'));
    playlistSelect.addEventListener('change',()=>{playlistId=playlistSelect.value;platformName=null;gameId=null;refresh();focusCurrent();});
    if(options.getPlaylists)tools.append(playlistSelect);
    tools.append(search, view, exit); header.append(brand, tools);
    const deck = element('section', 'sofa-deck'); deck.id = 'sofa-deck';
    deck.setAttribute('aria-label', t('sofa.games')); deck.setAttribute('aria-roledescription', t('sofa.carousel'));
    let cards = null;
    const previous = button('‹', () => moveGame(-1), 'sofa-arrow sofa-arrow-previous');
    previous.setAttribute('aria-label', t('sofa.previous'));
    const next = button('›', () => moveGame(1), 'sofa-arrow sofa-arrow-next');
    next.setAttribute('aria-label', t('sofa.next'));
    const empty = element('p', 'sofa-empty'); deck.append(previous, next, empty);
    const details = element('section', 'sofa-details');
    const caption = element('div', 'sofa-caption');
    const title = element('h1'); title.id = 'sofa-game-title';
    const subtitle = element('p', 'sofa-subtitle');
    const position = element('span', 'sofa-position'); position.setAttribute('aria-live', 'polite');
    caption.append(title, subtitle, position);
    const play = button('', () => void launch(), 'sofa-play'); play.id = 'sofa-play';
    const random = button('⤨', () => randomGame(), 'sofa-tool sofa-random'); random.setAttribute('aria-label', t('sofa.random'));
    const actions = element('div', 'sofa-actions'); actions.append(random, play); details.append(caption, actions);
    const railSection = element('section', 'sofa-platform-section');
    const rail = element('nav', 'sofa-platforms'); rail.id = 'sofa-platforms'; rail.setAttribute('aria-label', t('sofa.platforms'));
    railSection.append(rail);
    const footer = element('footer', 'sofa-footer');
    const hint = element('span', '', t('sofa.keyboardHelp'));
    const padStatus = element('span', 'sofa-pad-status'); footer.append(hint, padStatus);
    dialog.append(backdrop, header, deck, details, railSection, footer); document.body.append(dialog);

    let active = false, lease = null, opener = null, generation = 0, selectionVersion = 0;
    let platforms = [], games = [], platformName = null, gameId = null, zone = 'games', query = '';
    let playlistId='';
    const activePlaylist=()=>options.getPlaylists?.().find(list=>list.id===playlistId);
    const playlistGames=()=>{
      const list=activePlaylist();if(!list)return options.games();
      const byId=new Map(options.games().map(game=>[game.id,game]));return list.games.map(id=>byId.get(id)).filter(Boolean);
    };
    let boxMode = true, frame = null, previewTimer = null, previewGeneration = 0, previewWork = null;
    let platformPreviewAt = 0;
    let warmTimer = null, warmAbort = null, lastInteraction = 0;
    const warmedPaths = new Map(), visiblePaths = new Map();
    function retainPaths(platform) {
      options.retainArtwork?.(platform, [...new Set([...(warmedPaths.get(platform) || []), ...(visiblePaths.get(platform) || [])])]);
    }
    function warmStartupArtwork() {
      const controller = warmAbort = new AbortController();
      const jobs = startupArtwork(options.games(), options.sortGames, coverPaths);
      let index = 0;
      const current = () => active && !controller.signal.aborted;
      async function next() {
        warmTimer = null;
        if (!current() || index >= jobs.length) return;
        // Yield to navigation, model construction and modal actions. Only one
        // thumbnail decode runs at a time; originals/PDFs/models stay on demand.
        if (!document.hasFocus() || watchedGame !== null || busy || window.performance.now() - lastInteraction < 350 || previewWork || previewTimer !== null || topDialog() !== dialog) {
          warmTimer = window.setTimeout(next, 150); return;
        }
        const { platform, path } = jobs[index++];
        try {
          const image = options.getCoverPreview?.(path) || await options.loadCoverPreview?.(path, controller.signal);
          if (image && current()) {
            if (!warmedPaths.has(platform)) warmedPaths.set(platform, new Set());
            warmedPaths.get(platform).add(path); retainPaths(platform);
          }
        } catch { /* Missing thumbnails must not stop other consoles. */ }
        if (current()) warmTimer = window.setTimeout(next, 80);
      }
      warmTimer = window.setTimeout(next, 500);
    }
    let busy = false, availability = null, watchedGame = null, wasRunning = false, pendingFocus = false;
    let lastPad = false, selectedKey = null, backgroundAbort = null, lastBoxSelection = null, lastPollTime = null;
    let railDrag = null, railDragged = false;
    let lastRailNavigation = -Infinity, railScrollTarget = null;
    const remembered = new Map(), banks = new Map(), platformNodes = new Map(), padInput = createPadInput();
    let cardNodes = new Map(), spareCards = [], activeBank = null;
    let manualCard = null, boxMenu = null;
    const manualReader = root.OpenCabinetManualReader?.create({ imageSource:options.imageSource,helpText:t('sofa.manualHelp'),
      onClose:()=>{manualCard?._viewer?.returnManual?.();manualCard=null;} });
    const readingManual=()=>manualReader?.isOpen&&topDialog().classList.contains('manual-reader-dialog');
    function closeBoxMenu(focus=false) { boxMenu?.remove();boxMenu=null;if(focus)focusCurrent(); }
    function closeManual() { manualReader?.close(false,false); }
    function toggleBox() {
      closeBoxMenu();const node=cardNodes.get(gameId);
      if(!boxMode||!node?._viewer?.canOpen)return;
      node._wantManual=!node._viewer.isOpen;node._interacted=true;node._viewer.toggleOpen();
      if(node._viewer.isOpen&&!['ready','loading'].includes(node._manualState?.status))node._viewer.refreshManual?.();
    }
    function showBoxMenu(event,node) {
      closeBoxMenu();if(!boxMode||!node)return;
      if(Number(node.dataset.gameId)!==gameId)chooseGame(Number(node.dataset.gameId),false);
      const menu=boxMenu=element('div','sofa-context-menu');menu.setAttribute('role','menu');
      const open=button(t(node._viewer?.isOpen?'msg.59810c76a7':'msg.2d3b26a1ab'),toggleBox);
      open.disabled=!node._viewer?.canOpen;open.setAttribute('role','menuitem');
      const read=button(t('msg.297ba61d09'),()=>{closeBoxMenu();node._viewer?.readManual?.();});
      read.disabled=!node._viewer?.isOpen||node._manualState?.status!=='ready';read.setAttribute('role','menuitem');
      menu.append(open,read);dialog.append(menu);
      menu.style.left=`${Math.max(8,Math.min(event.clientX,window.innerWidth-menu.offsetWidth-8))}px`;
      menu.style.top=`${Math.max(8,Math.min(event.clientY,window.innerHeight-menu.offsetHeight-8))}px`;
      (open.disabled?read:open).focus({preventScroll:true});
    }
    try { boxMode = window.localStorage.getItem('opencabinet.sofaView') !== 'cover'; } catch {}
    const selected = () => games.find(game => game.id === gameId) || null;
    const coverPaths = game => {
      const images = options.images(game);
      return ['cover', 'box_full'].map(kind => images.find(image => image.kind === kind && image.path)?.path).filter(Boolean);
    };
    const controller = options.fullscreen;
    function topDialog() {
      const focused = document.activeElement?.closest?.('dialog[open]');
      return focused || dialog;
    }
    function focusCurrent() {
      const node = zone === 'platforms' ? platformNodes.get(platformName) : cardNodes.get(gameId);
      node?.focus({ preventScroll: true });
    }
    function showPosition(node) {
      if (!node || railDrag) return;
      // scrollIntoView also scrolls the dialog: its blurred backdrop extends
      // 50px beyond the viewport, allowing the whole screen to shift sideways.
      const item = node.getBoundingClientRect(), bounds = rail.getBoundingClientRect();
      const target = Math.max(0, Math.min(rail.scrollWidth - rail.clientWidth,
        rail.scrollLeft + item.left + item.width / 2 - bounds.left - rail.clientLeft - rail.clientWidth / 2));
      const now = window.performance.now(), rapid = now - lastRailNavigation < 220;
      lastRailNavigation = now;
      // Repeated smooth-scroll requests restart the browser's easing curve and
      // leave the selected console offscreen until input stops. During bursts,
      // move directly to the current selection instead of accumulating lag.
      if (railScrollTarget === target && (!rapid || Math.abs(rail.scrollLeft - target) < 1)) return;
      railScrollTarget = target;
      rail.scrollTo({ left: target,
        behavior: rapid || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
    function stopRailDrag(event) {
      if (!railDrag || (event && event.pointerId !== railDrag.id)) return;
      const { id, target } = railDrag; railDrag = null;
      rail.classList.remove('is-dragging');
      if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
    }
    function updateBoxVisibility() {
      for (const node of cardNodes.values()) {
        node.dataset.hasBox = String(boxMode && node._preview.children.length > 0);
        node.dataset.boxReady = String(node._boxKey === node._renderedBoxKey && !!node._viewer);
      }
      dialog.dataset.hasBox = String(boxMode && cardNodes.get(gameId)?.dataset.hasBox === 'true');
    }
    function clearCardPreview(node) {
      node._boxKey = null; node._renderedBoxKey = null;
      node._viewer?.dispose(); node._viewer = null;
      node._preview.replaceChildren(); node.dataset.hasBox = 'false';
    }
    function stopPreviewQueue() {
      ++previewGeneration; clearTimeout(previewTimer); previewTimer = null;
      previewWork = null;
    }
    function pauseBank(bank) {
      if (!bank || bank.paused) return;
      bank.paused = true;
      for (const node of [...bank.nodes.values(), ...bank.spare]) node._viewer?.suspend?.();
    }
    function resumeBank(bank) {
      if (!bank?.paused) return;
      bank.paused = false;
      for (const node of [...bank.nodes.values(), ...bank.spare]) node._viewer?.resume?.();
    }
    function pausePreview() {
      stopPreviewQueue(); pauseBank(activeBank);
      dialog.dataset.hasBox = 'false';
    }
    function disposeBank(bank) {
      bank.active = false;
      for (const node of [...bank.nodes.values(), ...bank.spare]) { node._abort.abort(); clearCardPreview(node); }
      bank.cards.remove(); banks.delete(bank.platform);
    }
    function selectBank() {
      if (activeBank?.platform === platformName) return;
      stopPreviewQueue();
      if (activeBank) {
        activeBank.active = false; activeBank.cards.hidden = true;
        for (const node of activeBank.nodes.values()) {
          node.classList.replace('sofa-card', 'sofa-cached'); node._selectArtwork?.(false);
          if (node._interacted) { node._viewer?.reset(); node._interacted = false; }
        }
        pauseBank(activeBank);
      }
      let bank = banks.get(platformName);
      if (!bank) {
        bank = { platform: platformName, cards: element('div', 'sofa-cards'), nodes: new Map(), spare: [], active: false, paused: true };
        deck.insertBefore(bank.cards, previous); banks.set(platformName, bank);
      }
      bank.active = true; bank.cards.hidden = false;
      for (const node of bank.nodes.values()) node.classList.replace('sofa-cached', 'sofa-card');
      activeBank = bank; cards = bank.cards; cardNodes = bank.nodes; spareCards = bank.spare; lastBoxSelection = null;
    }
    const observer = new window.MutationObserver(updateBoxVisibility);
    function preparePreviews() {
      if (!boxMode || watchedGame !== null) { pausePreview(); return; }
      const wait = platformPreviewAt - window.performance.now();
      if (wait > 0) {
        if (previewTimer === null) previewTimer = setTimeout(() => { previewTimer = null; preparePreviews(); }, wait);
        return;
      }
      resumeBank(activeBank);
      if (previewTimer !== null || previewWork !== null) return;
      const token = previewGeneration;
      const current = () => active && boxMode && watchedGame === null && previewGeneration === token;
      async function next() {
        previewTimer = null;
        if (!current()) return;
        // Read the current carousel, not a snapshot from an earlier key press.
        // Throttle model work without postponing it until navigation stops.
        const node = [...cardNodes.values()].filter(node => node._renderedBoxKey !== node._boxKey)
          .sort((a, b) => Math.abs(a._offset) - Math.abs(b._offset))[0];
        if (!node) return;
        const id = Number(node.dataset.gameId), item = games.find(game => game.id === id), key = node._boxKey;
        const work = previewWork = {};
        try {
          const settings = await options.boxSettings(item);
          if (current() && cardNodes.get(id) === node && node._boxKey === key && node._renderedBoxKey !== key) {
            // A recycled Three.js viewer keeps its renderer, geometry, lights
            // and materials. update replaces the artwork for the incoming game.
            node._viewer ||= options.createViewer(node._preview, { renderGroup: activeBank,
              loadManual:options.loadManual? (game,signal,onPreview)=>{
                if(!active||Number(node.dataset.gameId)!==gameId||!node._wantManual)return Promise.resolve(null);
                return options.loadManual(game,signal,onPreview);
              }:null,
              onManualState:state=>{node._manualState=state;},
              onManualActivate:({manual,game,origin})=>{
                if(!active||Number(node.dataset.gameId)!==gameId||!manualReader)return false;
                const opened=manualReader.open(manual,{title:game.title,origin,focusTarget:node._preview});if(opened)manualCard=node;return opened;
              },
              onManualDeactivate:()=>{if(manualCard===node)closeManual();},
            });
            node._viewer.update(options.sourceGame(item), options.images(item), settings);
            node._boxSettings = settings; node._settingsPlatform = item.platform;
            node._renderedBoxKey = key;
            updateBoxVisibility();
          }
        } catch (error) {
          if (current() && cardNodes.get(id) === node && node._boxKey === key) {
            console.warn('Sofa 3D preview', error); clearCardPreview(node); updateBoxVisibility();
          }
        } finally {
          if (previewWork === work) {
            previewWork = null;
            // Keep making progress during held input; obsolete jobs never
            // update recycled cards or stop the rest of the queue.
            if (current()) previewTimer = setTimeout(next, 40);
          }
        }
      }
      previewTimer = setTimeout(next, 0);
    }
    function drawCover(container, game, signal) {
      const path = options.images(game).find(image => image.kind === 'cover')?.path;
      const fallback = element('span', 'sofa-cover-fallback', game.title); container.append(fallback);
      if (!path) return;
      let preview = null, previewWidth = 0, image = null, timer = null, fadeTimer = null, selected = false;
      let artworkWidth = 0, artworkHeight = 0;
      // Reuse bounded thumbnails on both platforms. Box-mode navigation must
      // not also decode an original 2D cover for every briefly visited game.
      const cached = options.preferCachedArtwork || typeof options.loadCoverPreview === 'function';
      function fitArtwork() {
        const width = artworkWidth, height = artworkHeight;
        if (!width || !height) return;
        for (const node of [preview, image]) {
          const sourceWidth = node?.naturalWidth || node?.width, sourceHeight = node?.naturalHeight || node?.height;
          if (!sourceWidth || !sourceHeight) continue;
          const scale = Math.min(width / sourceWidth, height / sourceHeight);
          node.style.width = `${sourceWidth * scale}px`; node.style.height = `${sourceHeight * scale}px`;
        }
      }
      const sizeObserver = new window.ResizeObserver(entries => {
        artworkWidth = entries[0].contentRect.width; artworkHeight = entries[0].contentRect.height;
        fitArtwork();
      }); sizeObserver.observe(container);
      function showPreview(bitmap) {
        if (signal.aborted || !bitmap?.width || !bitmap?.height || bitmap.width <= previewWidth) return;
        try {
          const previous = preview;
          preview = bitmap.previewImage ? bitmap.cloneNode(false) : element('canvas');
          preview.className = 'sofa-cover';
          if (!bitmap.previewImage) { preview.width = bitmap.width; preview.height = bitmap.height; preview.getContext('2d').drawImage(bitmap, 0, 0); }
          container.append(preview); fallback.hidden = true;
          fitArtwork();
          previous?.remove(); previewWidth = bitmap.width;
          if (image?.dataset.ready === 'true') preview.hidden = true;
          else if (image?.isConnected) container.insertBefore(preview, image);
        } catch { preview = null; }
      }
      function original() {
        if (signal.aborted || image || (cached && (!selected || boxMode))) return;
        const originalImage = image = element('img', 'sofa-cover sofa-cover-original');
        originalImage.alt = ''; originalImage.decoding = 'async'; originalImage.fetchPriority = cached ? 'high' : 'auto';
        originalImage.style.opacity = '0';
        const current = () => !signal.aborted && image === originalImage && (!cached || (selected && !boxMode));
        originalImage.onload = async () => {
          try { await originalImage.decode?.(); } catch { return; }
          if (!current()) return;
          container.append(originalImage); fallback.hidden = true;
          fitArtwork();
          if (!preview) { originalImage.style.opacity = '1'; originalImage.dataset.ready = 'true'; return; }
          // Paint the decoded original above the preview before retiring it.
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            if (!current()) return;
            originalImage.style.opacity = '1';
            const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            fadeTimer = setTimeout(() => {
              if (!current()) return;
              originalImage.dataset.ready = 'true';
              if (preview) { if (cached) preview.hidden = true; else { preview.remove(); preview = null; } }
            }, reduced ? 0 : 180);
          }));
        };
        originalImage.src = options.imageSource(path);
      }
      const bitmap = options.getCoverPreview?.(path);
      showPreview(bitmap);
      if (cached) {
        // The existing thumbnail paints immediately; upgrade only to a bounded
        // couch-size preview, never to full-resolution originals for every card.
        Promise.resolve(options.loadCoverPreview?.(path, signal)).then(showPreview).catch(() => {});
      } else original();
      const select = value => {
        selected = value; if (!cached) return;
        clearTimeout(timer); if (!value || boxMode) clearTimeout(fadeTimer);
        if (value && !boxMode) timer = setTimeout(original, 250);
        else if (image) { image.onload = null; image.removeAttribute('src'); image.remove(); image = null; if (preview) preview.hidden = false; }
      };
      signal.addEventListener('abort', () => {
        sizeObserver.disconnect();
        clearTimeout(timer); clearTimeout(fadeTimer); if (image) { image.onload = null; image.removeAttribute('src'); }
        if (preview?.tagName === 'CANVAS') preview.width = preview.height = 0;
      }, { once: true });
      return select;
    }
    function renderCards() {
      selectBank();
      dialog.dataset.view = boxMode ? 'box' : 'cover';
      const index = games.findIndex(game => game.id === gameId);
      const visible = carousel(games, Math.max(0, index), boxMode ? 4 : 3);
      const retained = carousel(games, Math.max(0, index), 4).sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset));
      visiblePaths.set(platformName, retained.flatMap(({ item }) => coverPaths(item)));
      retainPaths(platformName);
      if (lastBoxSelection !== gameId) {
        for (const id of [lastBoxSelection, gameId]) {
          const node = cardNodes.get(id);
          if (node?._interacted) { node._viewer?.reset(); node._interacted = false; }
        }
        lastBoxSelection = gameId;
      }
      const keep = new Set(visible.map(({ item }) => item.id));
      for (const [id, node] of cardNodes) if (!keep.has(id)) {
        node._abort.abort(); node.classList.remove('sofa-card'); node.classList.add('sofa-spare'); cardNodes.delete(id); spareCards.push(node);
      }
      for (const { item, offset } of visible) {
        let node = cardNodes.get(item.id);
        const artKey = JSON.stringify([item.title, options.images(item).find(image => image.kind === 'cover')?.path]);
        if (!node) {
          node = spareCards.pop();
          if (node) {
            node.classList.remove('sofa-spare'); node.classList.add('sofa-card');
            node._viewer?.clearArtwork?.(); node._renderedBoxKey = null;
            node.style.transition = 'none';
            const recycled = node;
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
              if (recycled.isConnected) recycled.style.transition = '';
            }));
          }
          if (!node) {
            node = button('', () => { const id = Number(node.dataset.gameId); if (gameId === id) void launch(); else chooseGame(id, true); }, 'sofa-card');
            node.append(element('div', 'sofa-card-art'));
            node.append(element('div', 'sofa-box-placeholder'));
            node._preview = element('div', 'game-box-stage sofa-preview'); node._preview.tabIndex = -1;
            node._preview.setAttribute('aria-label', t('sofa.box'));
            node._preview.addEventListener('click', event => {
              if (gameId === Number(node.dataset.gameId)) event.stopPropagation();
            });
            for (const event of ['wheel','pointerdown']) node._preview.addEventListener(event, () => { node._interacted = true; }, { passive: true });
            observer.observe(node._preview, { childList: true });
            node.append(node._preview);
          }
          node.dataset.gameId = item.id; node._abort = new AbortController();
          node._wantManual=false;node._manualState={status:'none'};
          const art = node.querySelector('.sofa-card-art'); art.replaceChildren();
          node._selectArtwork = boxMode ? null : drawCover(art, item, node._abort.signal);
          node.setAttribute('aria-label', item.title); if (!node.isConnected) cards.append(node); cardNodes.set(item.id, node);
          node._artKey = boxMode ? null : artKey;
        } else if (!boxMode && node._artKey !== artKey) {
          node._abort.abort(); node._abort = new AbortController();
          const art = node.querySelector('.sofa-card-art'); art.replaceChildren();
          node._selectArtwork = drawCover(art, item, node._abort.signal); node._artKey = artKey; node.setAttribute('aria-label', item.title);
        }
        const distance = Math.abs(offset);
        node.hidden = false;
        const shape = root.OpenCabinet3D?.profileFor(item.platform, null, item.rom_path);
        if (shape) { node.style.setProperty('--box-aspect', shape.width / shape.height); node.style.setProperty('--box-color', shape.color); }
        const scale = boxMode ? (distance === 0 ? 1.2 : 1 - Math.min(3, distance) * 0.15)
          : distance === 0 ? 1 : Math.max(.44, .86 - distance * .12);
        // The first neighbors leave space for the enlarged center; subsequent
        // neighbors sit closer together, especially as they become smaller.
        const position = offset === 0 ? 0 : Math.sign(offset) * (1.2 + (distance - 1) * .76);
        node._offset = offset; node._scale = scale;
        // Inherited custom properties on the card invalidate every surface of
        // its 3D model on every key repeat. Only the outer transform moves.
        node.style.transform = `translateX(calc(-50% + ${position} * clamp(190px, 24vw, 360px))) translateY(-50%) scale(${scale})`;
        if (!boxMode) {
          const art = node.querySelector('.sofa-card-art');
          art.style.setProperty('--turn', `${offset === 0 ? 0 : offset > 0 ? -24 : 24}deg`);
          art.style.setProperty('--cover-width-scale', offset === 0 ? 1 : 1 / Math.cos(24 * Math.PI / 180));
        }
        node.style.zIndex = String(boxMode && offset === 0 ? 20 : 10 - Math.abs(offset)); node.classList.toggle('is-selected', offset === 0);
        node.tabIndex = offset === 0 ? 0 : -1; node.setAttribute('aria-current', String(offset === 0));
        node._selectArtwork?.(offset === 0);
        node._boxKey = JSON.stringify([options.sourceGame(item), options.images(item)]);
        // A warm shell can paint RAM artwork now. Only model construction or
        // a style/backend change belongs in the deferred preparation queue.
        if (boxMode && watchedGame === null && node._renderedBoxKey !== node._boxKey && node._settingsPlatform === item.platform
          && node._viewer?.updateCachedArtwork?.(options.sourceGame(item), options.images(item), node._boxSettings)) {
          node._renderedBoxKey = node._boxKey;
        }
      }
      for (const node of spareCards) node.hidden = true;
      preparePreviews();
      updateBoxVisibility();
      empty.hidden = games.length > 0; empty.textContent = t(query ? 'sofa.noResults' : 'sofa.empty');
      previous.hidden = next.hidden = games.length < 2;
      deck.classList.toggle('sofa-no-games', !games.length);
    }
    function status() {
      const game = selected(), running = !!game?.is_running;
      const missing = availability?.id === gameId && availability.available === false;
      play.disabled = !game || busy || running || missing;
      play.textContent = t(running ? 'sofa.running' : busy ? 'sofa.starting' : missing ? 'sofa.missing' : 'sofa.play');
      if (game && !running && !busy && !missing) root.OpenCabinetIcons?.label(play, t('sofa.play'), 'play');
      play.classList.toggle('sofa-missing', !!missing);
      if (game && !running && !missing) {
        const label = options.variantLabel?.(game);
        if (label) play.append(element('small', 'sofa-variants', label));
      }
      random.disabled = !games.length || busy;
    }
    function refreshSelected() {
      const game = selected();
      title.textContent = game?.title || t('sofa.emptyTitle');
      subtitle.textContent = game ? [game.platform, options.formatPlayTime(game)].filter(Boolean).join(' · ') : t('sofa.emptyHelp');
      position.textContent = game ? t('sofa.position', games.findIndex(item => item.id === gameId) + 1, games.length) : '';
      status();
      const key = game ? JSON.stringify([game.id, game.title, game.rom_path, game.default_region_id, options.images(game), game.box_3d, boxMode]) : null;
      if (key === selectedKey) return;
      const token = ++selectionVersion;
      selectedKey = key; availability = null; status();
      const images = game ? options.images(game) : [];
      const path = (images.find(image => image.kind === 'fanart_background') || images.find(image => image.kind === 'screenshot'))?.path;
      backgroundAbort?.abort(); backgroundAbort = new AbortController();
      if (path && options.preferCachedArtwork) {
        backdrop.style.backgroundImage = '';
        const show = bitmap => {
          if (!active || token !== selectionVersion || !bitmap) return;
          const url = bitmap.previewImage ? bitmap.src : bitmap.toDataURL?.('image/png');
          if (url) backdrop.style.backgroundImage = `url(${JSON.stringify(url)})`;
        };
        const bitmap = options.getCoverPreview?.(path);
        if (bitmap) show(bitmap);
        else Promise.resolve(options.loadCoverPreview?.(path, backgroundAbort.signal)).then(show).catch(() => {});
      } else backdrop.style.backgroundImage = path ? `url(${JSON.stringify(options.imageSource(path))})` : '';
      if (!game) return;
      Promise.resolve(options.availability?.(game)).then(result => {
        if (!active || token !== selectionVersion || gameId !== game.id) return;
        availability = { id: game.id, ...result }; status();
      }).catch(() => {});
    }
    function chooseGame(id, focus = false) {
      if (!games.some(game => game.id === id)) return;
      closeBoxMenu();closeManual();
      gameId = id; remembered.set(platformName, id); zone = 'games';
      renderCards(); refreshSelected(); if (focus) focusCurrent();
    }
    function moveGame(delta) {
      if (!games.length || busy) return;
      const index = games.findIndex(game => game.id === gameId); chooseGame(games[wrap(index + delta, games.length)].id, true);
    }
    function changePlatform(name, focus = true, reveal = true) {
      if (!platforms.some(platform => platform.name === name)) return;
      closeBoxMenu();closeManual();
      zone = 'platforms';
      if (name === platformName) {
        if (reveal) showPosition(platformNodes.get(name));
        if (focus) focusCurrent();
        return;
      }
      if (gameId !== null) remembered.set(platformName, gameId);
      const previous = platformNodes.get(platformName);
      previous?.setAttribute('aria-pressed', 'false'); if (previous) previous.tabIndex = -1;
      platformName = name;
      const node = platformNodes.get(name); node.setAttribute('aria-pressed', 'true'); node.tabIndex = 0;
      // Selection and focus respond immediately. Do not build/restore models
      // for consoles the user is only passing through during a burst of input.
      platformPreviewAt = window.performance.now() + 200;
      stopPreviewQueue(); refreshGames();
      if (reveal) showPosition(node);
      renderCards(); refreshSelected(); if (focus) focusCurrent();
    }
    function movePlatform(delta) {
      if (!platforms.length || busy) return;
      changePlatform(platforms[wrap(platforms.findIndex(platform => platform.name === platformName) + delta, platforms.length)].name);
    }
    async function randomGame() {
      if (!games.length || busy) return;
      if(options.chooseRandom){
        const token=generation;
        const game=await options.chooseRandom({platform:platformName,playlist:playlistId});
        if(!active||generation!==token||!game)return;
        if(activePlaylist()&&!activePlaylist().games.includes(game.id)){playlistId='';refresh();}
        if(!games.some(item=>item.id===game.id)){query='';search.value='';changePlatform(game.platform,false);}
        chooseGame(game.id,true);return;
      }
      const other = games.filter(game => game.id !== gameId);
      chooseGame((other.length ? other : games)[Math.floor(Math.random() * (other.length || games.length))].id, true);
    }
    function changeView() {
      closeBoxMenu();closeManual();
      boxMode = !boxMode; view.textContent = t(boxMode ? 'sofa.coverView' : 'sofa.boxView');
      view.setAttribute('aria-pressed', String(boxMode));
      try { window.localStorage.setItem('opencabinet.sofaView', boxMode ? 'box' : 'cover'); } catch {}
      renderCards();
      refreshSelected();
    }
    async function restoreFocus() {
      try { await options.restoreFocus?.(); } catch (error) { options.onError(error); }
      if (active) { selectedKey = null; renderCards(); refreshSelected(); zone = 'games'; focusCurrent(); padInput.reset(); }
    }
    async function launch() {
      const game = selected(); if (!active || !game || busy || game.is_running || play.disabled) return;
      busy = true; watchedGame = game.id; wasRunning = false; status();
      try {
        const result = await options.launch(game);
        if (!active) return;
        const current = options.games().find(item => item.id === game.id);
        if (result && current?.is_running) {
          wasRunning = true; pausePreview(); await options.minimize?.();
        } else { watchedGame = null; wasRunning = false; }
      } catch (error) { watchedGame = null; wasRunning = false; options.onError(error); }
      finally {
        busy = false;
        if (active) {
          status();
          if (pendingFocus) { pendingFocus = false; await restoreFocus(); }
          else if (watchedGame === null) { selectedKey = null; renderCards(); refreshSelected(); focusCurrent(); }
        }
      }
    }
    function updateStatistics(game) {
      if (!active) return;
      if (game.id === watchedGame) {
        if (game.is_running) wasRunning = true;
        else if (wasRunning) {
          watchedGame = null; wasRunning = false;
          if (busy) pendingFocus = true; else void restoreFocus();
        }
      }
      if (game.id === gameId) { subtitle.textContent = [game.platform, options.formatPlayTime(game)].join(' · '); status(); }
    }
    function refreshGames() {
      const source = playlistGames().filter(game => platformName === null || game.platform === platformName)
        .filter(game => !query || game.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      games = activePlaylist()?source:options.sortGames(source);
      gameId = games.some(game => game.id === remembered.get(platformName)) ? remembered.get(platformName)
        : games.some(game => game.id === gameId) ? gameId : games[0]?.id ?? null;
    }
    function refresh() {
      if (!active) return;
      const library = options.games();
      const savedLists=options.getPlaylists?.()||[];
      if(!savedLists.some(list=>list.id===playlistId))playlistId='';
      playlistSelect.replaceChildren();const all=element('option','',t('random.any'));all.value='';playlistSelect.append(all);
      for(const list of savedLists){const item=element('option','',list.name);item.value=list.id;playlistSelect.append(item);}playlistSelect.value=playlistId;
      platforms = platformsFor(playlistGames(), options.platforms());
      options.pruneArtwork?.(new Set(library.flatMap(coverPaths)), new Set(platformsFor(library,options.platforms()).map(platform => platform.name)));
      if (!platforms.some(platform => platform.name === platformName)) platformName = null;
      refreshGames();
      const names = new Set(platforms.map(platform => platform.name));
      for (const bank of banks.values()) if (bank !== activeBank && !names.has(bank.platform)) disposeBank(bank);
      for (const [name, node] of platformNodes) if (!names.has(name)) { node.remove(); platformNodes.delete(name); }
      let platformIndex = 0;
      for (const platform of platforms) {
        let node = platformNodes.get(platform.name);
        if (!node) {
          node = button('', event => changePlatform(platform.name, true, event.detail === 0), 'sofa-platform');
          node.dataset.platform = platform.name ?? ''; const art = element('span', 'sofa-platform-art', platform.name === null ? '◈' : '◉');
          node.append(art, element('span', 'sofa-platform-name', platform.name ?? t('sofa.all')),
            element('small', 'sofa-platform-count')); platformNodes.set(platform.name, node);
          if (platform.name !== null) Promise.resolve(options.platformDetails(platform)).then(data => {
            if (!active || !node.isConnected) return;
            const logo = data.images?.find(image => image.kind === 'logo'); if (!logo) return;
            const image = element('img'); image.alt = ''; image.decoding = 'async'; image.draggable = false;
            image.onload = () => { if (active && node.isConnected) art.replaceChildren(image); };
            image.src = options.imageSource(logo.path);
          }).catch(() => {});
        }
        // Moving an existing focused button out and back into the rail loses
        // native focus and can disturb an in-progress horizontal scroll.
        const existing = rail.children[platformIndex++];
        if (existing !== node) rail.insertBefore(node, existing || null);
        node.setAttribute('aria-pressed', String(platform.name === platformName));
        node.tabIndex = platform.name === platformName ? 0 : -1;
        node.querySelector('small').textContent = String(platform.count);
      }
      showPosition(platformNodes.get(platformName));
      renderCards(); refreshSelected();
    }
    function modalAction(modal, action) {
      const controls = [...modal.querySelectorAll('button, input, select, [tabindex="0"]')]
        .filter(node => !node.disabled && !node.hidden && node.getClientRects().length);
      const current = document.activeElement, index = controls.indexOf(current);
      if (action === 'back' || action === 'exit') {
        const event = new window.Event('cancel', { cancelable: true });
        if (modal.dispatchEvent(event)) modal.close(); return;
      }
      if(action==='previousPlatform'||action==='nextPlatform'){
        controls[wrap(index+(action==='previousPlatform'?-1:1),controls.length)]?.focus();return;
      }
      if (['left', 'up', 'right', 'down'].includes(action)) {
        if(current?.type==='number'){
          if(['left','up'].includes(action))current.stepDown();else current.stepUp();
          current.dispatchEvent(new window.Event('change',{bubbles:true}));
        }else if (current?.tagName === 'SELECT') {
          current.selectedIndex = wrap(current.selectedIndex + (['left', 'up'].includes(action) ? -1 : 1), current.options.length);
          current.dispatchEvent(new window.Event('change', { bubbles: true }));
        } else controls[wrap(index + (['left', 'up'].includes(action) ? -1 : 1), controls.length)]?.focus();
      } else if (action === 'accept') {
        if (index < 0) controls[0]?.focus(); else if (current.tagName === 'BUTTON'||current.type==='checkbox') current.click();
      }
    }
    function action(name) {
      lastInteraction = window.performance.now();
      if (!active) return;
      if(readingManual()) {
        if(['back','exit','manual'].includes(name))manualReader.close();
        else if(['left','previousPlatform'].includes(name))manualReader.step(-1);
        else if(['right','nextPlatform'].includes(name))manualReader.step(1);
        else if(name==='up'||name==='down')manualReader.pan(0,name==='up'?-100:100);
        return;
      }
      const modal = topDialog(); if (modal !== dialog) { modalAction(modal, name); return; }
      if(boxMenu){if(name==='back'){closeBoxMenu(true);return;}if(['left','right','up','down','accept'].includes(name)){modalAction(boxMenu,name);return;}}
      if(name==='openBox'){toggleBox();return;}
      if(name==='manual'){if(boxMode)cardNodes.get(gameId)?._viewer?.readManual?.();return;}
      if (name === 'exit') { close(); return; }
      if (name === 'back') { if (zone === 'games') { zone = 'platforms'; focusCurrent(); } else close(); return; }
      if (name === 'previousPlatform' || name === 'nextPlatform') { movePlatform(name === 'previousPlatform' ? -1 : 1); return; }
      if (name === 'view') { changeView(); return; }
      if (name === 'turn') { const node = cardNodes.get(gameId); if (node) { node._interacted = true; node._viewer?.toggleSide(); } return; }
      if (name === 'up' || name === 'down') { zone = name === 'up' ? 'games' : 'platforms'; focusCurrent(); return; }
      if (name === 'left' || name === 'right') { (zone === 'platforms' ? movePlatform : moveGame)(name === 'left' ? -1 : 1); return; }
      if (name === 'accept') {
        const focused = document.activeElement;
        if (focused?.tagName === 'BUTTON' && !focused.classList.contains('sofa-card') && !focused.classList.contains('sofa-platform')) focused.click();
        else if (zone === 'platforms') { zone = 'games'; focusCurrent(); }
        else void launch();
      }
    }
    function rotateSelected(pad, elapsed) {
      if (!active || !boxMode || busy || watchedGame !== null || topDialog() !== dialog
        || document.activeElement?.matches?.('input, textarea, select')) return false;
      const stick = rightStick(pad), node = cardNodes.get(gameId);
      if (!stick || !elapsed || node?.dataset.boxReady !== 'true' || !node._viewer?.rotate) return false;
      node._interacted = true;
      // Degrees per millisecond: analog speed, with no jump after a slow frame.
      node._viewer.rotate(stick[0] * elapsed * .11, stick[1] * elapsed * .11);
      return true;
    }
    function poll() {
      if (!active) return;
      const now = window.performance.now();
      let pad = null;
      try { pad = [...(window.navigator.getGamepads?.() || [])].find(pad => pad?.connected && pad.mapping === 'standard'); } catch {}
      const connected = !!pad;
      if (connected !== lastPad) {
        lastPad = connected; hint.textContent = t(connected ? 'sofa.padHelp' : 'sofa.keyboardHelp');
        padStatus.textContent = t(connected ? 'sofa.padConnected' : 'sofa.padConnect');
      }
      if (document.visibilityState !== 'hidden' && document.hasFocus()) {
        const elapsed = lastPollTime === null ? 0 : Math.max(0, Math.min(50, now - lastPollTime));
        lastPollTime = now;
        for (const command of padInput.sample(pad, now)) action(command);
        if(pad&&elapsed&&!busy&&watchedGame===null){
          const value=index=>{const v=pad.buttons?.[index]?.value;return Number.isFinite(v)?Math.max(0,Math.min(1,v)):pad.buttons?.[index]?.pressed?1:0;};
          const zoom=value(7)-value(6),delta=Math.abs(zoom)>.1?zoom*elapsed*.001:0;
          if(readingManual()){
            if(delta)manualReader.zoom(delta);
            const stick=rightStick(pad);if(stick)manualReader.pan(stick[0]*elapsed*.7,stick[1]*elapsed*.7);
          }else if(boxMode&&topDialog()===dialog&&!document.activeElement?.matches?.('input, textarea, select')&&delta){
            const node=cardNodes.get(gameId);if(node?._viewer){node._interacted=true;node._viewer.zoom(delta);}
          }
        }
        rotateSelected(pad, elapsed);
      } else { padInput.reset(); lastPollTime = null; }
      // Menu input must not wait for the 3D renderer's next animation frame.
      if (active) frame = window.setTimeout(poll, document.hasFocus() ? 16 : 150);
    }
    async function open(initial = {}) {
      if (active) return;
      opener = document.activeElement; active = true; const token = ++generation;
      lastRailNavigation = -Infinity; railScrollTarget = null;
      platformPreviewAt = 0;
      if (gameId === null) { gameId = initial.gameId ?? null; platformName = initial.platform ?? null; }
      zone = 'games'; query = ''; search.value = ''; lastPad = false; lastPollTime = null;
      hint.textContent = t('sofa.keyboardHelp'); padStatus.textContent = t('sofa.padConnect');
      view.textContent = t(boxMode ? 'sofa.coverView' : 'sofa.boxView'); view.setAttribute('aria-pressed', String(boxMode));
      dialog.showModal(); refresh(); focusCurrent();
      lastInteraction = window.performance.now(); warmStartupArtwork();
      padInput.reset(); frame = window.setTimeout(poll, 0);
      const entry = controller?.acquire(() => { if (token === generation) close(); }); lease = entry;
      try {
        await entry?.ready;
        if (active && token === generation) { await options.focus?.(); focusCurrent(); }
      } catch (error) { options.onError(error); }
      if (token !== generation) { if (lease === entry) lease = null; await entry?.release(); }
    }
    function close() {
      if (!active) return;
      closeBoxMenu();closeManual();
      stopRailDrag(); railDragged = false;
      active = false; ++generation; ++selectionVersion;
      warmAbort?.abort(); warmAbort = null; window.clearTimeout(warmTimer); warmTimer = null;
      warmedPaths.clear(); visiblePaths.clear();
      backgroundAbort?.abort(); backgroundAbort = null;
      watchedGame = null; wasRunning = false; pendingFocus = false; selectedKey = null;
      window.clearTimeout(frame); padInput.reset(); stopPreviewQueue();
      for (const bank of banks.values()) disposeBank(bank);
      activeBank = null; cards = null; cardNodes = new Map(); spareCards = []; lastBoxSelection = null;
      observer.disconnect();
      platformNodes.clear(); rail.replaceChildren();
      dialog.close(); const old = lease; lease = null; void old?.release();
      opener?.focus?.({ preventScroll: true });
    }
    window.addEventListener('keydown', event => {
      if (!active || topDialog() !== dialog || event.defaultPrevented || event.isComposing) return;
      if(boxMenu&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeBoxMenu(true);return;}
      if (event.key === 'Escape' || event.key === 'F11') { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopImmediatePropagation(); search.focus(); return; }
      if (event.target.matches?.('input, textarea, select')) return;
      if(boxMode&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&['o','m'].includes(event.key.toLowerCase())){
        event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)action(event.key.toLowerCase()==='o'?'openBox':'manual');return;
      }
      const names = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'accept', ' ': 'accept' };
      const command = names[event.key];
      if (command) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat || !['accept'].includes(command)) action(command);
      }
    }, true);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (active && !dialog.open) close(); });
    dialog.addEventListener('contextmenu', event => { event.preventDefault();event.stopPropagation();showBoxMenu(event,event.target.closest?.('.sofa-card')); }, true);
    dialog.addEventListener('pointerdown',event=>{if(boxMenu&&!boxMenu.contains(event.target))closeBoxMenu();},true);
    dialog.addEventListener('focusin', event => {
      if (event.target.closest('.sofa-platform')) zone = 'platforms';
      else if (event.target.closest('.sofa-card')) zone = 'games';
    });
    rail.addEventListener('pointerdown', event => {
      railDragged = false;
      if (!active || event.button !== 0 || event.isPrimary === false || event.pointerType === 'touch'
        || rail.scrollWidth <= rail.clientWidth) return;
      const bounds = rail.getBoundingClientRect();
      // Leave the native scrollbar usable; touch keeps the webview's own pan.
      if (event.clientY >= bounds.top + rail.clientTop + rail.clientHeight) return;
      event.preventDefault();
      rail.scrollTo({ left: rail.scrollLeft, behavior: 'instant' });
      railScrollTarget = null;
      const target = event.target.closest('.sofa-platform') || rail;
      railDrag = { id: event.pointerId, target, x: event.clientX, left: rail.scrollLeft };
      target.setPointerCapture(event.pointerId);
    });
    rail.addEventListener('pointermove', event => {
      if (!railDrag || event.pointerId !== railDrag.id) return;
      const distance = event.clientX - railDrag.x;
      if (!railDragged && Math.abs(distance) < 6) return;
      railDragged = true; rail.classList.add('is-dragging'); event.preventDefault();
      rail.scrollTo({ left: railDrag.left - distance, behavior: 'instant' });
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) rail.addEventListener(name, stopRailDrag);
    rail.addEventListener('click', event => {
      if (railDragged && event.detail !== 0) {
        railDragged = false; event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    rail.addEventListener('dragstart', event => event.preventDefault());
    search.addEventListener('input', () => { query = search.value.trim(); refresh(); });
    window.addEventListener('blur', () => { padInput.reset(); lastPollTime = null; stopRailDrag(); });
    for (const event of ['pointerdown', 'pointermove', 'keydown', 'wheel']) dialog.addEventListener(event, () => { lastInteraction = window.performance.now(); }, { passive: true });
    window.addEventListener('beforeunload', () => { close(); observer.disconnect(); }, { once: true });
    return { open, close, refresh, updateStatistics, get active() { return active; } };
  }
  const api = { create, createPadInput, rightStick, carousel, platformsFor, wrap, startupArtwork };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenCabinetSofa = api;
})(globalThis);
