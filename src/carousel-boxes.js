// Closed legacy cases keep their molded geometry; only the printed sheets change.
// Desktop viewers and opened boxes continue to use the complete existing viewer.
(() => {
  const encodedPreviews = new WeakMap();
  let neutralImage = null;
  function blankImage() {
    if (!neutralImage) { neutralImage = document.createElement('canvas'); neutralImage.width = neutralImage.height = 1;
      const context = neutralImage.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 1, 1); }
    return neutralImage;
  }
  const originalJobs = []; let originalActive = 0;
  function pumpOriginals() {
    while (originalActive < 2 && originalJobs.length) {
      const job = originalJobs.shift(); if (job.signal.aborted) { job.cancel(); continue; }
      ++originalActive; job.start(() => { --originalActive; pumpOriginals(); });
    }
  }
  function loadOriginal(path, signal, imageSource, delay = 650) {
    return new Promise((resolve, reject) => {
      let image = null, complete = null, done = false;
      const finish = (error, value) => {
        if (done) return; done = true; clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        if (image) { image.onload = image.onerror = null; if (error) image.src = ''; }
        complete?.(); error ? reject(error) : resolve(value);
      };
      const cancel = () => finish(new DOMException('Aborted', 'AbortError'));
      const job = { signal, cancel, start(callback) {
        complete = callback;
        if (done) { complete(); return; }
        image = new Image(); image.crossOrigin = 'anonymous'; image.decoding = 'async'; image.fetchPriority = 'low';
        image.onload = async () => {
          try { await image.decode?.(); finish(null, image); } catch (error) { finish(error); }
        };
        image.onerror = () => finish(Error('Carousel artwork unavailable')); image.src = imageSource(path);
      } };
      const timer = setTimeout(() => { if (!done) { originalJobs.push(job); pumpOriginals(); } }, delay);
      if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
    });
  }
  let spineDecoder = null, spineActive = false;
  const spineJobs = [];
  function pumpSpines() {
    if (spineActive) return;
    const job = spineJobs.shift(); if (!job) return;
    if (job.signal.aborted) { job.cancel(); pumpSpines(); return; }
    spineActive = true;
    void job.start().finally(() => { spineActive = false; pumpSpines(); });
  }
  function loadSpine(path, signal, imageSource, delay = 0) {
    if (!globalThis.OpenCabinetCovers?.createDecoder) return loadOriginal(path, signal, imageSource, delay);
    // A separate worker/queue keeps side-art preparation off the UI thread and
    // out of the front-cover download slots. Independent pixels also suit WebKit.
    spineDecoder ||= globalThis.OpenCabinetCovers.createDecoder({ transferPixels: true });
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, bitmap) => {
        if (done) { bitmap?.close?.(); return; }
        done = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
        if (error) { reject(error); return; }
        const release = () => bitmap.close?.();
        signal.addEventListener('abort', release, { once: true });
        resolve(bitmap);
      };
      const cancel = () => finish(new DOMException('Aborted', 'AbortError'));
      const job = { signal, cancel, async start() {
        if (done) return;
        try {
          let image = await spineDecoder(imageSource(path), signal, null, { fullCover: true, maxEdge: 2048 });
          if (!image.previewBlob && !signal.aborted) { image.close?.(); image = await loadOriginal(path, signal, imageSource, 0); }
          finish(null, image);
        }
        catch (error) { finish(error); }
      } };
      const timer = setTimeout(() => { if (!done) { spineJobs.push(job); pumpSpines(); } }, delay);
      if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
    });
  }
  function createLegacy(host, options, createViewer) {
    const api3d = globalThis.OpenCabinet3D, atlas = globalThis.OpenCabinetImages;
    let source = null, geometryKey = null, bindings = [], model = null, profile = null;
    let controller = null, revision = 0, expanded = false, disposed = false;
    const urls = new Set();
    const fades = new Set();
    const createShell = () => createViewer(host, { ...options, carousel: true, deferArtwork: true,
      loadManual: null, getCoverPreview: () => null, loadCoverPreview: null });
    let inner = createShell();
    function geometryFor(game, shape) {
      const { color, translucency, ...geometry } = shape;
      return JSON.stringify([geometry, game.platform]);
    }
    function clearArtwork() {
      ++revision; controller?.abort(); controller = null;
      for (const fade of fades) { clearTimeout(fade.timer); fade.previous.remove(); } fades.clear();
      if (!model) return;
      for (const kind of ['cover', 'back_cover', 'spine']) {
        model.style.setProperty(`--box-texture-${kind}`, 'none');
        model.style.setProperty(`--box-texture-size-${kind}`, '100% 100%');
        model.style.setProperty(`--box-texture-position-${kind}`, '0% 0%');
        model.style.setProperty(`--box-paper-${kind}`, 'var(--box-material)');
      }
      for (const binding of bindings) { binding.layer.classList.remove('loaded'); Object.assign(binding.layer.style, { backgroundImage: 'none', opacity: '1', transition: '' }); }
      for (const url of urls) URL.revokeObjectURL(url); urls.clear();
      delete model.dataset.fullCover; host.dataset.artworkReady = 'false';
      delete model.dataset.spineRotated;
    }
    function previewSource(bitmap) {
      if (bitmap.previewImage) return { url: bitmap.src, width: bitmap.naturalWidth || bitmap.width, height: bitmap.naturalHeight || bitmap.height };
      if (bitmap.previewBlob) {
        const url = URL.createObjectURL(bitmap.previewBlob); urls.add(url);
        return { url, ...(bitmap.previewSize || { width: bitmap.width, height: bitmap.height }) };
      }
      if (!encodedPreviews.has(bitmap)) {
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        encodedPreviews.set(bitmap, canvas.toDataURL('image/webp', .92));
      }
      return { url: encodedPreviews.get(bitmap), width: bitmap.width, height: bitmap.height };
    }
    async function load(path, signal, kind) {
      const cached = options.getCoverPreview?.(path) || await options.loadCoverPreview?.(path, signal);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (cached?.width && cached?.height) return { ...previewSource(cached), cached: true };
      const image = await (kind === 'spine' ? loadSpine : loadOriginal)(path, signal, options.imageSource, 0);
      if (image.previewBlob) return previewSource(image);
      return { url: image.src, width: image.naturalWidth, height: image.naturalHeight };
    }
    function paint(kind, image, full = false, smooth = false) {
      const front = bindings.find(binding => binding.kind === 'cover');
      const size = front ? { width: profile.width * parseFloat(front.base.width) / 100,
        height: profile.height * parseFloat(front.base.height) / 100, depth: profile.depth } : profile;
      const regions = full && atlas?.wrapRegions(size, image.width >= image.height ? 'x' : 'y');
      const region = regions?.[kind] || { size: '100% 100%', position: '0% 0%' };
      const url = `url(${JSON.stringify(image.url)})`;
      model.style.setProperty(`--box-texture-${kind}`, url);
      model.style.setProperty(`--box-texture-size-${kind}`, region.size);
      model.style.setProperty(`--box-texture-position-${kind}`, region.position);
      model.style.setProperty(`--box-paper-${kind}`, '#f4f1e9');
      for (const binding of bindings.filter(binding => binding.kind === kind)) {
        let fade = null;
        if (smooth && binding.layer.classList.contains('loaded')) {
          const previous = binding.layer, layer = document.createElement('div'); layer.className = 'game-box-wrap-texture';
          Object.assign(layer.style, { opacity: '0', transition: 'opacity 180ms ease' });
          previous.after(layer); binding.layer = layer;
          fade = { previous, layer, timer: null }; fades.add(fade);
        }
        Object.assign(binding.layer.style, binding.base, { transform: '', backgroundImage: url,
          backgroundSize: region.size, backgroundPosition: region.position });
        const horizontal = full ? image.height > image.width : image.width > image.height;
        const wideSurface = binding.width > binding.height;
        if (kind === 'spine' && horizontal !== wideSurface) {
          model.dataset.spineRotated = 'true';
          const faceWidth = binding.faceWidth, faceHeight = binding.faceHeight;
          Object.assign(binding.layer.style, { width: `${binding.height / faceWidth * 100}%`, height: `${binding.width / faceHeight * 100}%`,
            left: `${parseFloat(binding.base.left) + parseFloat(binding.base.width) / 2}%`,
            top: `${parseFloat(binding.base.top) + parseFloat(binding.base.height) / 2}%`, transform: 'translate(-50%, -50%) rotate(90deg)' });
        }
        binding.layer.classList.add('loaded');
        if (fade) requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!fades.has(fade)) return;
          fade.layer.style.opacity = '1';
          const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
          if (reduced) fade.layer.style.transition = 'none';
          fade.timer = setTimeout(() => { fade.previous.remove(); fades.delete(fade); }, reduced ? 0 : 180);
        }));
      }
      if (kind === 'cover') host.dataset.artworkReady = 'true';
      if (full) model.dataset.fullCover = 'preview';
    }
    async function applyArtwork(images) {
      controller = new AbortController(); const signal = controller.signal, token = revision;
      const current = () => !disposed && !expanded && token === revision && !signal.aborted;
      const resolved = atlas?.resolve(images) || images, full = resolved.find(image => image.kind === 'box_full')?.path;
      // A full wrap may not be resident yet even though its front cover is.
      // Paint available front artwork now, then let the full wrap replace it.
      if (full && !options.getCoverPreview?.(full)) {
        const path = resolved.find(image => image.kind === 'cover')?.path;
        const cached = path && options.getCoverPreview?.(path);
        if (cached?.width && cached?.height) paint('cover', previewSource(cached));
      }
      async function upgrade(path, cached, apply, kind) {
        if (!cached.cached) return;
        try {
          const image = await (kind === 'spine' ? loadSpine : loadOriginal)(path, signal, options.imageSource, 650);
          if (current()) apply(image.previewBlob ? previewSource(image) : { url: image.src, width: image.naturalWidth, height: image.naturalHeight });
        } catch { /* Retain the cached print. */ }
      }
      if (full) try {
        const image = await load(full, signal); if (!current()) return;
        for (const kind of ['cover', 'back_cover', 'spine']) paint(kind, image, true);
        void upgrade(full, image, original => { for (const kind of ['cover', 'back_cover', 'spine']) paint(kind, original, true, true); });
        return;
      } catch { if (!current()) return; }
      await Promise.all(['cover', 'back_cover', 'spine'].map(async kind => {
        const path = resolved.find(image => image.kind === kind)?.path; if (!path) return;
        try { const image = await load(path, signal, kind); if (current()) { paint(kind, image); void upgrade(path, image, original => paint(kind, original, false, true), kind); } } catch { /* Keep the unprinted case. */ }
      }));
    }
    function promote() {
      if (expanded || !source) return;
      clearArtwork(); expanded = true;
      inner.dispose(); inner = createViewer(host, { ...options, carousel: true });
      inner.update(...source);
    }
    const openKey = event => { if (event.key?.toLowerCase() === 'o') promote(); };
    host.addEventListener('keydown', openKey, true);
    const api = {
      updateCachedArtwork(game, images, settings = null) {
        const resolved = api3d.resolveSettings(settings, game.box_3d);
        const shape = api3d.profileFor(game.platform, null, game.rom_path, resolved);
        if (disposed || expanded || geometryKey !== geometryFor(game, shape)) return false;
        api.update(game, images, settings); return true;
      },
      update(game, images, settings = null) {
        if (disposed) return;
        source = [game, images, settings];
        const resolved = api3d.resolveSettings(settings, game.box_3d);
        const next = api3d.profileFor(game.platform, null, game.rom_path, resolved);
        const region = api3d.regionFor(game.rom_path);
        const nextKey = geometryFor(game, next);
        clearArtwork();
        if (nextKey !== geometryKey || expanded) {
          if (expanded) { inner.dispose(); inner = createShell(); }
          // A stable identity and empty texture bindings build the shell once.
          expanded = false; geometryKey = nextKey; profile = next;
          const tag = { europe: 'Europe', north_america: 'USA', japan: 'Japan' }[region] || '';
          inner.update({ ...game, id: -1, title: '', rom_path: `Case (${tag})` },
            ['cover', 'back_cover', 'spine'].map(kind => ({ kind, path: `carousel:${kind}` })), settings);
          model = host.querySelector('.game-box-model'); bindings = [];
          for (const [name, kind] of [['front','cover'], ['back','back_cover'], [next.spineFace === 'top' ? 'top' : 'left','spine']]) {
            const face = model.querySelector(`[data-face="${name}"]`), image = face?.querySelector('img'); if (!image) continue;
            image.style.visibility = 'hidden';
            const fallback = face.querySelector('.game-box-fallback'); if (fallback) fallback.hidden = true;
            const layer = document.createElement('div'); layer.className = 'game-box-wrap-texture'; face.appendChild(layer);
            const faceWidth = name === 'left' ? next.depth : next.width, faceHeight = name === 'top' ? next.depth : next.height;
            const base = Object.fromEntries(['left','top','width','height'].map(key => [key, image.style[key] || (['width','height'].includes(key) ? '100%' : '0%')]));
            bindings.push({ kind, layer, base, faceWidth, faceHeight, width: faceWidth * parseFloat(base.width) / 100, height: faceHeight * parseFloat(base.height) / 100 });
          }
        }
        profile = next;
        model.style.setProperty('--box-material', next.color);
        model.style.setProperty('--box-shell-opacity', String(next.translucency ?? 1));
        if (['jewel','jewelPal','longbox'].includes(next.id)) {
          const style = resolved?.regions?.[region] || resolved?.base;
          const tray = /^#[\da-f]{6}$/i.test(style?.color || '') ? style.color
            : /dreamcast/i.test(game.platform) ? region === 'europe' ? '#204b85' : '#b8c2c9' : '#181a1e';
          model.style.setProperty('--box-jewel-tray', tray);
          model.dataset.spineLabelTone = region === 'japan' ? 'light' : 'dark';
        }
        inner.reset(); host.setAttribute('aria-label', game.title); host.dataset.carouselGeometry = geometryKey;
        void applyArtwork(images);
      },
      clearArtwork,
      get canOpen() { return inner.canOpen; }, get isOpen() { return inner.isOpen; }, get rotationLock() { return inner.rotationLock; },
      get hasDisc(){return inner.hasDisc??false;},get isDiscRemoved(){return inner.isDiscRemoved??false;},
      setOpen(value, animate = true) { if (value) promote(); return inner.setOpen(value, animate); },
      toggleOpen() { return api.setOpen(!inner.isOpen); },
      clear() { clearArtwork(); inner.clear(); source = model = geometryKey = null; bindings = []; },
      dispose() { api.clear(); disposed = true; host.removeEventListener('keydown', openKey, true); inner.dispose(); },
    };
    for (const name of ['reset','zoom','rotate','toggleSide','showBack','setRotationLock','readManual','returnManual','refreshManual','suspend','resume','removeDisc','returnDisc','examineDisc']) api[name] = (...args) => inner[name]?.(...args);
    return api;
  }
  async function cachedImage(path, signal, options) {
    const bitmap = options.getCoverPreview?.(path) || await options.loadCoverPreview?.(path, signal);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!bitmap?.width || !bitmap?.height) return null;
    const canvas = document.createElement('canvas'), scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  globalThis.OpenCabinetCarouselBoxes = { createLegacy, cachedImage, loadOriginal, loadSpine, blankImage };
})();
