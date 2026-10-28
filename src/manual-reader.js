// A booklet uses PDF carillas as the front/back of physical leaves. No disk cache.
(() => {
  const sides = (spread, count) => [spread ? spread * 2 : null, spread * 2 + 1].map(page => page && page <= count ? page : null);
  const firstPage = spread => spread ? spread * 2 : 1;
  const maxSpread = count => Math.floor(count / 2);
  const offset = (spread, count) => spread === 0 ? '-25%' : spread * 2 === count ? '25%' : '0%';
  const readingLayouts=['auto','booklet','nested','spreads','original'];
  function create({ imageSource = value => value, openPDF = (...args) => globalThis.OpenCabinetManualPDF.open(...args), onClose = () => {} } = {}) {
    let active = null;
    const readingPreferenceKey = 'opencabinet.manualReadingModes';
    let readingModes = {};
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(readingPreferenceKey) || 'null');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) readingModes = saved;
    } catch { /* Infer the layout from the cover when no preference is available. */ }
    const nativeFullscreen = globalThis.OpenCabinetWindowFullscreen?.forWindow(globalThis.__TAURI__?.window?.getCurrentWindow?.());
    const el = (tag, text, className) => {
      const node = document.createElement(tag); if (text) node.textContent = text;
      if (className) node.className = className; return node;
    };
    const button = (label, text, handler) => {
      const node = el('button', text, 'secondary-btn'); node.type = 'button'; node.title = label;
      node.setAttribute('aria-label', label); node.addEventListener('click', handler); return node;
    };
    const free = canvas => { if (canvas) canvas.width = canvas.height = 0; };
    function snapshot(canvas) {
      if (!canvas?.width || !canvas.height) return null;
      const copy = el('canvas'); copy.width = canvas.width; copy.height = canvas.height;
      copy.getContext('2d', { alpha: false }).drawImage(canvas, 0, 0); return copy;
    }
    function release(s, entry) { if (entry.owned) s.doc?.release(entry.canvas); else free(entry.canvas); }
    function trim(s) {
      s.retired.forEach(entry => release(s, entry)); s.retired = [];
      const visible = sides(s.spread, s.count);
      for (const [page, entry] of s.cache) {
        if (s.cache.size <= 4) break;
        if (!visible.includes(page)) { release(s, entry); s.cache.delete(page); }
      }
    }
    function fit(s, resetScroll = false) {
      if (active !== s) return;
      const bounds = s.viewport.getBoundingClientRect();
      // Leave room for the leaf to rise toward the viewer during its turn.
      const width = Math.max(120, bounds.width - 80), height = Math.max(120, bounds.height - 112);
      const h = Math.min(height, width / (s.ratio * 2)) * s.zoom, w = h * s.ratio * 2;
      Object.assign(s.book.style, { width: `${w}px`, height: `${h}px` });
      Object.assign(s.center.style, { width: `${Math.max(bounds.width, w + 56)}px`, height: `${Math.max(bounds.height, h + 48)}px` });
      s.viewport.dataset.zoomed = String(s.zoom > 1);
      if (resetScroll) { s.viewport.scrollLeft = Math.max(0, (w + 56 - bounds.width) / 2); s.viewport.scrollTop = 0; }
    }
    function animate(s, returning = false) {
      if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !s.book.animate) return null;
      const from = s.origin?.getBoundingClientRect(), to = s.book.getBoundingClientRect();
      if (!from?.width || !from.height || !to.width || !to.height) return null;
      const dx = from.left + from.width / 2 - to.left - to.width / 2;
      const dy = from.top + from.height / 2 - to.top - to.height / 2;
      const visibleWidth = sides(s.spread, s.count).filter(Boolean).length === 1 ? to.width / 2 : to.width;
      const small = `translate(${dx}px,${dy}px) scale(${from.width / visibleWidth},${from.height / to.height})`;
      return s.book.animate(returning
        ? [{ transform: 'none', opacity: 1 }, { transform: small, opacity: .4 }]
        : [{ transform: small, opacity: .4 }, { transform: 'none', opacity: 1 }],
      { duration: returning ? 200 : 360, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'both' });
    }
    function controls(s) {
      s.previous.disabled = s.closing || s.wanted <= 0; s.next.disabled = s.closing || s.wanted >= maxSpread(s.count);
      s.previousEdge.disabled = s.previous.disabled; s.nextEdge.disabled = s.next.disabled;
      s.input.value = String(s.page); s.input.max = String(s.count); s.input.disabled = s.closing;
      s.total.textContent = globalThis.OpenCabinetI18n.t("msg.f5636b5075", s.count); s.fitButton.textContent = s.zoom === 1 ? globalThis.OpenCabinetI18n.t("msg.1f90f84c2f") : `${Math.round(s.zoom * 100)} %`;
      s.zoomOut.disabled = s.zoom <= 1 || s.closing; s.zoomIn.disabled = s.zoom >= 3 || s.closing;
    }
    function face(s, node, page) {
      const entry = page && s.cache.get(page);
      node.dataset.page = entry ? String(page) : ''; node.dataset.empty = String(!entry);
      const baseWidth=node===s.leafFront||node===s.leafBack?100:50;
      const actual=entry?.canvas?.width/entry?.canvas?.height;
      const ratio=Number.isFinite(actual)&&actual>0?actual:s.ratio;
      const width=Math.min(1,ratio/s.ratio),height=Math.min(1,s.ratio/ratio);
      // Fit the whole page surface to its image, rather than fitting an image
      // inside a larger white sheet. Mixed-size PDF scans must not gain borders.
      Object.assign(node.style,{width:`${baseWidth*width}%`,height:`${height*100}%`,top:`${(1-height)*50}%`});
      if (entry) { node.replaceChildren(entry.canvas); entry.canvas.setAttribute('aria-label', globalThis.OpenCabinetI18n.t("msg.19198aaeed", page)); }
      else node.replaceChildren();
    }
    function show(s, spread) {
      const [left, right] = sides(spread, s.count);
      face(s, s.left, left); face(s, s.right, right);
      s.leaf.style.display = 'none'; s.leafFront.replaceChildren(); s.leafBack.replaceChildren();
      s.paper.style.transform = `translateX(${offset(spread, s.count)})`;
      s.book.dataset.cover = spread === 0 ? 'front' : right === null ? 'back' : 'open';
      s.book.dataset.turning = 'false'; s.spread = spread;
      s.previousEdge.hidden = !left; s.nextEdge.hidden = !right;
      const pages = [left, right].filter(Boolean);
      s.book.setAttribute('aria-label', globalThis.OpenCabinetI18n.t("msg.0defc62b3c", pages.length === 1 ? globalThis.OpenCabinetI18n.t("msg.8f63f4d759") : globalThis.OpenCabinetI18n.t("msg.4a8f019db6"), pages.join(' y '), s.count));
      trim(s);
    }
    async function ensurePage(s, page, signal) {
      if (!page) return;
      const old = s.cache.get(page);
      if (old?.ready) { s.cache.delete(page); s.cache.set(page, old); return; }
      const canvas = await s.doc.renderPage(page, { signal, maxSide: 3072 });
      if (active !== s || s.closing || signal.aborted) { s.doc.release(canvas); return; }
      if (old) s.retired.push(old);
      s.cache.set(page, { canvas, owned: true, ready: true });
    }
    async function turnLeaf(s, target) {
      stopPan(s);
      const forward = target > s.spread;
      const old = sides(s.spread, s.count), next = sides(target, s.count);
      // Four different carillas: stationary underlay plus both sides of one leaf.
      // Move each canvas, rather than blanking or mirroring the current picture.
      face(s, s.left, forward ? old[0] : next[0]);
      face(s, s.right, forward ? next[1] : old[1]);
      face(s, s.leafFront, forward ? old[1] : next[1]);
      face(s, s.leafBack, forward ? next[0] : old[0]);
      s.leaf.style.display = ''; s.turning = true;
      s.book.dataset.turning = forward ? 'forward' : 'backward';
      s.book.dataset.cover = 'open';
      const start = forward ? 0 : -180, end = forward ? -180 : 0;
      const fromOffset = offset(s.spread, s.count), toOffset = offset(target, s.count);
      s.leaf.style.transform = `translateZ(1px) rotateY(${start}deg)`;
      s.turnAnimations = [];
      if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches && s.leaf.animate) {
        const options = { duration: 650, easing: 'cubic-bezier(.35,.05,.3,1)', fill: 'both' };
        s.turnAnimations.push(s.leaf.animate([{ transform: `translateZ(1px) rotateY(${start}deg)` },
          { transform: `translateZ(1px) rotateY(${end}deg)` }], options));
        if (fromOffset !== toOffset) s.turnAnimations.push(s.paper.animate([
          { transform: `translateX(${fromOffset})` }, { transform: `translateX(${toOffset})` }], options));
        await Promise.all(s.turnAnimations.map(animation => Promise.resolve(animation.finished).catch(() => {})));
      }
      if (active === s && !s.closing) {
        show(s, target);
        s.turnAnimations.forEach(animation => animation.cancel()); s.turnAnimations = []; s.turning = false;
      }
    }
    async function display(s) {
      if (active !== s || s.closing || !s.doc || s.running) return;
      s.running = true; s.book.setAttribute('aria-busy', 'true'); s.error.textContent = ''; s.retry.hidden = true;
      try {
        while (active === s && !s.closing && (!s.rendered || s.spread !== s.wanted)) {
          const target = !s.rendered ? s.spread : s.jump ? s.wanted : s.spread + Math.sign(s.wanted - s.spread);
          const task = new AbortController(); s.pageTask = task;
          try {
            const needed = [...new Set([...sides(s.spread, s.count), ...sides(target, s.count)].filter(Boolean))];
            await Promise.all(needed.map(page => ensurePage(s, page, task.signal)));
            if (active !== s || s.closing) return;
            if (task.signal.aborted) { trim(s); continue; }
            if (!s.rendered) { show(s, s.spread); s.rendered = true; }
            else await turnLeaf(s, target);
          } catch (error) {
            const cancelled = task.signal.aborted; task.abort();
            if (active !== s || s.closing) return;
            trim(s);
            if (cancelled) continue;
            s.error.textContent = globalThis.OpenCabinetI18n.t("msg.25aecf4144");
            s.retry.hidden = false; return;
          }
        }
      } finally {
        s.running = false;
        if (active === s && !s.closing) { s.book.setAttribute('aria-busy', 'false'); controls(s); }
      }
    }
    async function load(s) {
      if (s.loading || active !== s || s.closing) return;
      s.loading = true; s.book.setAttribute('aria-busy', 'true'); s.error.textContent = ''; s.retry.hidden = true;
      try {
        const doc = await openPDF(s.path, { imageSource, signal: s.lifetime.signal, layout: s.readingMode, coverSide: s.coverSide });
        if (active !== s || s.closing) { doc.dispose(); return; }
        s.doc = doc; s.count = doc.pageCount; s.page = Math.min(s.page, s.count); s.wanted = Math.floor(s.page / 2);
        if(Number.isFinite(doc.aspectRatio)&&doc.aspectRatio>0){s.ratio=doc.aspectRatio;fit(s);}
        controls(s); await display(s);
      } catch (error) {
        if (active === s && !s.closing) { s.error.textContent = globalThis.OpenCabinetI18n.t("msg.3152cf27b5"); s.retry.hidden = false; }
      } finally {
        s.loading = false; if (active === s && !s.closing && !s.doc) s.book.setAttribute('aria-busy', 'false');
      }
    }
    function go(s, page, jump = true) {
      if (active !== s || s.closing || !Number.isInteger(page) || page < 1 || page > s.count) { controls(s); return; }
      const wanted = Math.floor(page / 2), changed = s.wanted !== wanted;
      s.page = page; s.wanted = wanted; s.jump = jump; controls(s);
      // Finish a leaf already in the air. Only a preparation can be cancelled.
      if (changed && !s.turning) s.pageTask?.abort();
      if (s.doc) display(s);
    }
    function step(s, delta) {
      const target = Math.max(0, Math.min(maxSpread(s.count), s.wanted + delta));
      if (target !== s.wanted) go(s, firstPage(target), false);
    }
    function stopPan(s, event) {
      if (!s.pan || (event && event.pointerId !== s.pan.id)) return;
      const id = s.pan.id; s.pan = null; s.viewport.dataset.dragging = 'false';
      if (s.viewport.hasPointerCapture(id)) s.viewport.releasePointerCapture(id);
    }
    function zoom(s, value, anchor = null) {
      if (s.closing) return;
      const next = Math.max(1, Math.min(3, value)); if (next === s.zoom) return;
      stopPan(s);
      // Keep the point under the mouse (or viewport center for buttons) in place.
      const bounds = s.viewport.getBoundingClientRect();
      const x = anchor ? anchor.clientX - bounds.left : bounds.width / 2;
      const y = anchor ? anchor.clientY - bounds.top : bounds.height / 2;
      const oldWidth = parseFloat(s.book.style.width), oldHeight = parseFloat(s.book.style.height);
      const px = ((s.viewport.scrollLeft || 0) + x - (parseFloat(s.center.style.width) - oldWidth) / 2) / oldWidth;
      const py = ((s.viewport.scrollTop || 0) + y - (parseFloat(s.center.style.height) - oldHeight) / 2) / oldHeight;
      s.zoom = next; controls(s); fit(s);
      const width = parseFloat(s.book.style.width), height = parseFloat(s.book.style.height);
      const contentWidth = parseFloat(s.center.style.width), contentHeight = parseFloat(s.center.style.height);
      s.viewport.scrollLeft = Math.max(0, Math.min(contentWidth - bounds.width, (contentWidth - width) / 2 + px * width - x));
      s.viewport.scrollTop = Math.max(0, Math.min(contentHeight - bounds.height, (contentHeight - height) / 2 + py * height - y));
    }
    function close(withAnimation = true, restoreFocus = true, notify = true) {
      const s = active; if (!s) return;
      if (s.closing) { if (!withAnimation) { s.animation?.cancel(); s.finish(); } return; }
      s.closing = true; stopPan(s); s.animation?.cancel(); controls(s);
      // Keep the visible faces intact for the trip back, even in mid-turn.
      s.copies = [];
      for (const node of [s.left, s.right, s.leafFront, s.leafBack]) {
        const copy = withAnimation ? snapshot(node.children[0]) : null;
        node.replaceChildren(...(copy ? [copy] : [])); if (copy) s.copies.push(copy);
      }
      const transform = globalThis.getComputedStyle?.(s.leaf).transform;
      const paperTransform = globalThis.getComputedStyle?.(s.paper).transform;
      s.turnAnimations.forEach(animation => animation.cancel());
      if (transform && transform !== 'none') s.leaf.style.transform = transform;
      if (paperTransform && paperTransform !== 'none') s.paper.style.transform = paperTransform;
      s.pageTask?.abort(); s.cache.forEach(entry => release(s, entry)); s.cache.clear();
      s.retired.forEach(entry => release(s, entry)); s.retired = [];
      s.lifetime.abort(); s.doc?.dispose(); s.observer.disconnect();
      let finished = false;
      s.finish = () => {
        if (finished) return; finished = true;
        s.copies.forEach(free); s.copies = [];
        s.dialog.close(); s.dialog.remove(); if (active === s) active = null;
        s.nativeLease?.release(); s.nativeLease = null;
        if (notify) onClose();
        if (restoreFocus && s.focusTarget?.isConnected !== false) s.focusTarget?.focus({ preventScroll: true });
      };
      s.animation = withAnimation && s.copies.length ? animate(s, true) : null;
      if (s.animation) Promise.resolve(s.animation.finished).catch(() => {}).then(s.finish);
      else s.finish();
    }
    const api = {
      get isOpen() { return !!active; },
      open(manual, { title = globalThis.OpenCabinetI18n.t("msg.b0b9fe24ff"), origin = null, focusTarget = null, readingMode = readingModes[manual.path] } = {}) {
        close(false, false);
        if (!readingLayouts.includes(readingMode)) readingMode = 'auto';
        const booklet = readingMode==='booklet'||readingMode==='nested'||(readingMode==='auto'&&manual.splitCover);
        const dialog = el('dialog', null, 'manual-reader-dialog'); dialog.setAttribute('aria-label', globalThis.OpenCabinetI18n.t("msg.63e31b372a", title));
        const header = el('header', null, 'manual-reader-header'); header.append(el('h2', globalThis.OpenCabinetI18n.t("msg.23871abd2e", title)));
        header.append(button(globalThis.OpenCabinetI18n.t("msg.b2954ba4b9"), globalThis.OpenCabinetI18n.t("msg.af1359c7c2"), () => close()));
        const layoutLabel = el('label', globalThis.OpenCabinetI18n.t("msg.b02ea97257"), 'manual-reader-layout');
        const layoutSelect = el('select'); layoutSelect.setAttribute('aria-label', globalThis.OpenCabinetI18n.t("msg.8cd5384fd3"));
        for (const [value, text] of [['auto',globalThis.OpenCabinetI18n.t('manual.readingAuto')],['booklet', globalThis.OpenCabinetI18n.t("msg.0463315afa")],
          ['nested', globalThis.OpenCabinetI18n.t("msg.e5f08bf5a6")],['spreads',globalThis.OpenCabinetI18n.t('manual.readingSpreads')], ['original', globalThis.OpenCabinetI18n.t("msg.e263ce9df7")]]) {
          const option = el('option', text); option.value = value; layoutSelect.append(option);
        }
        layoutSelect.value = readingMode; layoutLabel.append(layoutSelect); header.append(layoutLabel);
        layoutSelect.addEventListener('change', () => {
          if (active !== s || s.closing || !readingLayouts.includes(layoutSelect.value)) return;
          const mode = layoutSelect.value;
          if(mode==='auto')delete readingModes[manual.path];else readingModes[manual.path] = mode;
          try { globalThis.localStorage?.setItem(readingPreferenceKey, JSON.stringify(readingModes)); } catch {}
          // Replace only the reading session; keep the extracted booklet and
          // fullscreen ownership, and cancel every outstanding old page task.
          close(false, false, false); api.open(manual, { title, origin: null, focusTarget, readingMode: mode });
        });
        const viewport = el('div', null, 'manual-reader-viewport'), center = el('div', null, 'manual-reader-center');
        const book = el('div', null, 'manual-reader-book'), paper = el('div', null, 'manual-reader-paper');
        const left = el('div', null, 'manual-reader-page manual-reader-left'), right = el('div', null, 'manual-reader-page manual-reader-right');
        const leaf = el('div', null, 'manual-reader-leaf'); leaf.setAttribute('aria-hidden', 'true');
        const leafFront = el('div', null, 'manual-reader-leaf-face manual-reader-leaf-front');
        const leafBack = el('div', null, 'manual-reader-leaf-face manual-reader-leaf-back'); leaf.append(leafFront, leafBack);
        const edge = (label, text, delta, side) => {
          const node = button(label, text, event => { if (!s.dragged || event.detail === 0) step(s, delta); });
          node.className = `manual-reader-edge manual-reader-edge-${side}`; return node;
        };
        const previousEdge = edge(globalThis.OpenCabinetI18n.t("msg.68b3597d75"), '‹', -1, 'left');
        const nextEdge = edge(globalThis.OpenCabinetI18n.t("msg.2b8c99dd02"), '›', 1, 'right');
        paper.append(left, right, el('div', null, 'manual-reader-gutter'), leaf, previousEdge, nextEdge);
        book.append(paper); center.append(book); viewport.append(center);
        const nav = el('div', null, 'manual-reader-nav'); nav.setAttribute('aria-label', globalThis.OpenCabinetI18n.t("msg.145b63eae5"));
        const previous = button(globalThis.OpenCabinetI18n.t("msg.a2877eb25c"), '‹', () => step(s, -1));
        const next = button(globalThis.OpenCabinetI18n.t("msg.7104b2a259"), '›', () => step(s, 1));
        const label = el('label', globalThis.OpenCabinetI18n.t("msg.fefcf69f82")), input = el('input'); input.type = 'number'; input.min = '1'; input.step = '1';
        input.setAttribute('aria-label', globalThis.OpenCabinetI18n.t("msg.6ea49b6597")); const total = el('span'); total.setAttribute('aria-live', 'polite'); label.append(input, total);
        const zoomOut = button(globalThis.OpenCabinetI18n.t("msg.79112cdddd"), '−', () => zoom(s, s.zoom - .25));
        const zoomIn = button(globalThis.OpenCabinetI18n.t("msg.5a7eaf7830"), '+', () => zoom(s, s.zoom + .25));
        const fitButton = button(globalThis.OpenCabinetI18n.t("msg.cc6bc8265b"), globalThis.OpenCabinetI18n.t("msg.1f90f84c2f"), () => zoom(s, 1));
        nav.append(previous, label, next, zoomOut, fitButton, zoomIn);
        const status = el('div', null, 'manual-reader-status'), error = el('p'); error.setAttribute('role', 'alert');
        const retry = button(globalThis.OpenCabinetI18n.t("msg.8b7a2fdca0"), globalThis.OpenCabinetI18n.t("msg.a9254c5f81"), () => s.doc ? display(s) : load(s)); retry.hidden = true; status.append(error, retry);
        dialog.append(header, viewport, status, nav);
        const cover = booklet === !!manual.splitCover ? snapshot(manual.front) : null;
        const s = { dialog, viewport, center, book, paper, left, right, leaf, leafFront, leafBack,
          previous, next, previousEdge, nextEdge, input, total, zoomOut, zoomIn, fitButton, error, retry,
          path: manual.path, count: manual.pageCount * (booklet ? 2 : 1), readingMode, coverSide: manual.coverMode === 'left' ? 'left' : 'right',
          page: 1, spread: 0, wanted: 0, rendered: false, jump: false,
          ratio: (manual.sourceAspectRatio || (manual.splitCover ? manual.aspectRatio * 2 : manual.aspectRatio)
            || (manual.front?.width / manual.front?.height) || 2 / 3) / (booklet ? 2 : 1),
          cache: new Map(cover ? [[1, { canvas: cover, owned: false, ready: false }]] : []), retired: [], turnAnimations: [],
          zoom: 1, origin, focusTarget, lifetime: new AbortController(), closing: false };
        active = s; show(s, 0);
        viewport.setAttribute('aria-label', globalThis.OpenCabinetI18n.t("msg.4726ed81af"));
        viewport.addEventListener('wheel', event => {
          if (s.closing || !Number.isFinite(event.deltaY) || !event.deltaY) return;
          event.preventDefault(); event.stopPropagation();
          const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.getBoundingClientRect().height : 1);
          zoom(s, s.zoom * Math.exp(-Math.max(-200, Math.min(200, pixels)) * .0015), event);
        }, { passive: false });
        viewport.addEventListener('pointerdown', event => {
          if (s.closing || s.turning || s.pan || event.button !== 0) return;
          s.dragged = false;
          s.pan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft || 0, top: viewport.scrollTop || 0 };
        });
        viewport.addEventListener('pointermove', event => {
          if (!s.pan || s.pan.id !== event.pointerId) return;
          const dx = event.clientX - s.pan.x, dy = event.clientY - s.pan.y;
          s.dragged ||= Math.hypot(dx, dy) > 5;
          if (!s.dragged) return;
          event.preventDefault();
          if (!viewport.hasPointerCapture(event.pointerId)) viewport.setPointerCapture(event.pointerId);
          if (s.zoom > 1) {
            viewport.dataset.dragging = 'true';
            viewport.scrollLeft = s.pan.left - dx; viewport.scrollTop = s.pan.top - dy;
          }
        });
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => viewport.addEventListener(name, event => stopPan(s, event)));
        viewport.addEventListener('dragstart', event => event.preventDefault());
        input.addEventListener('change', () => go(s, Number(input.value)));
        dialog.addEventListener('keydown', event => {
          if (s.closing || event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.target === input) { if (event.key === 'Enter') { event.preventDefault(); go(s, Number(input.value)); } return; }
          if (['ArrowLeft', 'PageUp', 'ArrowRight', 'PageDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            if (event.key === 'Home' || event.key === 'End') go(s, event.key === 'Home' ? 1 : s.count);
            else step(s, event.key === 'ArrowLeft' || event.key === 'PageUp' ? -1 : 1);
          }
        });
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        s.observer = new ResizeObserver(() => fit(s)); s.observer.observe(viewport);
        document.body.append(dialog); dialog.showModal(); controls(s); fit(s);
        // Share ownership with an expanded box; returning to it keeps fullscreen.
        s.nativeLease = nativeFullscreen?.acquire(() => { if (active === s) close(false); });
        s.animation = animate(s); load(s); return true;
      },
      close,
      dispose() { close(false, false); },
    };
    return api;
  }
  globalThis.OpenCabinetManualReader = { create };
})();
