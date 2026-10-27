// Previews keep page 1; the back cover is optional and rendered only on demand.
(() => {
  const isPS2 = game => /^(sony)?playstation2$|^ps2$/.test(String(game?.platform || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const isJewelBooklet = game => /^(sony)?playstation(1)?$|^ps1?$|^(sega)?dreamcast$/.test(String(game?.platform || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const supportsGame = game => isPS2(game) || isJewelBooklet(game);
  let library;
  async function pdfLibrary() {
    library ??= import('./vendor/pdfjs/pdf.min.mjs').then(pdf => {
      pdf.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
      return pdf;
    }).catch(error => { library = null; throw error; });
    return library;
  }
  function dimensions(profile, info) {
    if (!Number.isFinite(info.aspectRatio) || info.aspectRatio <= 0 || !Number.isInteger(info.pageCount) || info.pageCount < 1) {
      throw new Error(globalThis.OpenCabinetI18n.t("msg.18885412bf"));
    }
    if(['jewel','jewelPal'].includes(profile.id)) {
      const width=profile.width-14.6,height=profile.height-2.6,sheets=Math.ceil(info.pageCount/2);
      return {width,height,sheets,thickness:Math.min(2.5,.26+sheets*.06),x:6,y:0};
    }
    const height = Math.min(profile.height - 6, (profile.width - 14) / info.aspectRatio);
    const width = height * info.aspectRatio;
    const sheets = Math.ceil(info.pageCount / 2);
    return { width, height, sheets, thickness: Math.min(3.4, 0.26 + sheets * 0.075),
      x: profile.width / 2 - 8 - width / 2, y: 0 };
  }
  async function render(path, { imageSource = value => value, signal, loadLibrary = pdfLibrary, coverMode = 'auto', maxSide = 2048 } = {}) {
    const abort = () => { if (signal?.aborted) throw new DOMException(globalThis.OpenCabinetI18n.t("msg.92a2872d72"), 'AbortError'); };
    abort(); const pdf = await loadLibrary(); abort();
    const resource = folder => new URL(`vendor/pdfjs/${folder}/`, document.baseURI).href;
    const task = pdf.getDocument({ url: imageSource(path), isEvalSupported: false, enableXfa: false,
      cMapUrl: resource('cmaps'), cMapPacked: true, standardFontDataUrl: resource('standard_fonts'),
      wasmUrl: resource('wasm'), iccUrl: resource('iccs') });
    const canvases = []; let rendering = null, destroyed = false, disposed = false, backTask = null, backController = null, back;
    const destroy = () => { if (!destroyed) { destroyed = true; return task.destroy(); } };
    const onAbort = () => { rendering?.cancel(); Promise.resolve(destroy()).catch(() => {}); };
    signal?.addEventListener('abort', onAbort, { once: true });
    function release() { disposed=true;backController?.abort();canvases.forEach(canvas => { canvas.width = canvas.height = 0; }); }
    try {
      abort(); const doc = await task.promise; abort();
      const first = await doc.getPage(1); abort();
      const viewport = first.getViewport({ scale: 1 });
      const sourceAspectRatio = viewport.width / viewport.height;
      if (!Number.isFinite(sourceAspectRatio) || sourceAspectRatio <= 0) throw new Error(globalThis.OpenCabinetI18n.t("msg.e8600759e8"));
      if (!['auto', 'full', 'left', 'right'].includes(coverMode)) coverMode = 'auto';
      // A typical PS2 cover spread is landscape, with a portrait page on each
      // side. Very wide foldouts and square/portrait pages stay intact in Auto.
      const splitCover = coverMode === 'left' || coverMode === 'right'
        || (coverMode === 'auto' && sourceAspectRatio >= 1.05 && sourceAspectRatio <= 1.7);
      const coverSide = splitCover ? (coverMode === 'left' ? 'left' : 'right') : 'full';
      const aspectRatio = sourceAspectRatio / (splitCover ? 2 : 1);
      async function draw(page) {
        abort(); const box = page.getViewport({ scale: 1 });
        const side=Number.isFinite(maxSide)?Math.max(128,Math.min(2048,maxSide)):2048;
        const view = page.getViewport({ scale: Math.min(3, side / Math.max(box.width / (splitCover ? 2 : 1), box.height)) });
        const canvas = document.createElement('canvas'); canvases.push(canvas);
        canvas.width = Math.max(1, Math.ceil(view.width / (splitCover ? 2 : 1))); canvas.height = Math.max(1, Math.ceil(view.height));
        // Clip directly into the final cover canvas: never allocate a full
        // spread texture or rasterize another PDF page just to obtain the cover.
        rendering = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: view, background: '#ffffff',
          ...(coverSide === 'right' ? { transform: [1, 0, 0, 1, -view.width / 2, 0] } : {}) });
        await rendering.promise; rendering = null; page.cleanup(); abort(); return canvas;
      }
      const front = await draw(first);
      const pageCount=doc.numPages;
      return { path, pageCount, aspectRatio, sourceAspectRatio, splitCover, coverMode, front,
        get back() { return back; },
        async loadBack() {
          abort();if(disposed)throw new DOMException(globalThis.OpenCabinetI18n.t("msg.92a2872d72"),'AbortError');
          if(back)return back;
          if(backTask)return backTask;
          if(pageCount===1&&!splitCover)return back=front;
          const controller=new AbortController();backController=controller;
          const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
          backTask=(async()=>{
            let reader;
            try {
              reader=await open(path,{imageSource,loadLibrary,signal:controller.signal,
                layout:splitCover?'booklet':'original',coverSide:coverSide==='left'?'left':'right'});
              const canvas=await reader.renderPage(reader.pageCount,{maxSide:2048});
              abort();if(disposed||controller.signal.aborted)throw new DOMException(globalThis.OpenCabinetI18n.t("msg.92a2872d72"),'AbortError');
              // Transfer only this canvas out of the short-lived reading session.
              // Folded scans use the opposite half of page 1, not the last scan.
              reader.detach(canvas);canvases.push(canvas);back=canvas;return canvas;
            } finally {reader?.dispose();signal?.removeEventListener('abort',cancel);}
          })().catch(error=>{backTask=null;throw error;});
          return backTask;
        },
        dispose: release };
    } catch (error) {
      release(); if (signal?.aborted) throw new DOMException(globalThis.OpenCabinetI18n.t("msg.92a2872d72"), 'AbortError'); throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      await Promise.resolve(destroy()).catch(() => {});
    }
  }
  async function open(path, { imageSource = value => value, signal, loadLibrary = pdfLibrary, layout = 'original', coverSide = 'right' } = {}) {
    const cancelled = () => new DOMException(globalThis.OpenCabinetI18n.t("msg.92a2872d72"), 'AbortError');
    const check = () => { if (signal?.aborted) throw cancelled(); };
    check(); const pdf = await loadLibrary(); check();
    const resource = folder => new URL(`vendor/pdfjs/${folder}/`, document.baseURI).href;
    const task = pdf.getDocument({ url: imageSource(path), isEvalSupported: false, enableXfa: false,
      cMapUrl: resource('cmaps'), cMapPacked: true, standardFontDataUrl: resource('standard_fonts'),
      wasmUrl: resource('wasm'), iccUrl: resource('iccs') });
    const canvases = new Set(), renders = new Set(); let disposed = false;
    const release = canvas => { canvas.width = canvas.height = 0; canvases.delete(canvas); };
    function dispose() {
      if (disposed) return;
      disposed = true; signal?.removeEventListener('abort', dispose);
      renders.forEach(render => render.cancel()); renders.clear();
      canvases.forEach(release);
      Promise.resolve(task.destroy()).catch(() => {});
    }
    signal?.addEventListener('abort', dispose, { once: true });
    try {
      const doc = await task.promise; check();
      if (disposed) throw cancelled();
      if (!Number.isInteger(doc.numPages) || doc.numPages < 1) throw new Error(globalThis.OpenCabinetI18n.t("msg.7d9efe8ff6"));
      const booklet = layout === 'booklet' || layout === 'nested';
      const pageCount = doc.numPages * (booklet ? 2 : 1);
      return { path, pageCount, sourcePageCount: doc.numPages, release, dispose,
        detach(canvas) { if(!canvases.delete(canvas))throw new Error('Canvas does not belong to this PDF session.'); },
        async renderPage(number, { signal: pageSignal, maxSide = 3072 } = {}) {
          const current = () => { check(); if (disposed || pageSignal?.aborted) throw cancelled(); };
          current();
          if (!Number.isInteger(number) || number < 1 || number > pageCount) throw new Error(globalThis.OpenCabinetI18n.t("msg.85f45f2a59"));
          // Each successive scan alternates the front/back of a folded sheet:
          // [N,1], [2,N-1], [N-2,3], [4,N-3], ... . Map lazily, without
          // requesting, rasterizing or keeping the other PDF pages in memory.
          const low = number <= doc.numPages;
          const scanIndex = booklet ? (low ? number - 1 : pageCount - number) : number - 1;
          let rightHalf = layout === 'nested' ? low : (scanIndex % 2 === 0 ? low : !low);
          if (coverSide === 'left') rightHalf = !rightHalf;
          let canvas, drawing, page;
          const cancel = () => drawing?.cancel();
          pageSignal?.addEventListener('abort', cancel, { once: true });
          try {
            page = await doc.getPage(scanIndex + 1); current();
            const box = page.getViewport({ scale: 1 });
            if (![box.width, box.height].every(value => Number.isFinite(value) && value > 0)) throw new Error(globalThis.OpenCabinetI18n.t("msg.21ea61a51b"));
            const side = Number.isFinite(maxSide) ? Math.max(512, Math.min(4096, maxSide)) : 3072;
            const viewport = page.getViewport({ scale: side / Math.max(box.width / (booklet ? 2 : 1), box.height) });
            canvas = document.createElement('canvas'); canvases.add(canvas);
            canvas.width = Math.max(1, Math.ceil(viewport.width / (booklet ? 2 : 1))); canvas.height = Math.max(1, Math.ceil(viewport.height));
            drawing = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport, background: '#ffffff',
              ...(booklet && rightHalf ? { transform: [1, 0, 0, 1, -viewport.width / 2, 0] } : {}) });
            renders.add(drawing); await drawing.promise; current();
            return canvas;
          } catch (error) {
            if (canvas) release(canvas);
            if (disposed || signal?.aborted || pageSignal?.aborted) throw cancelled();
            throw error;
          } finally {
            if (drawing) renders.delete(drawing);
            pageSignal?.removeEventListener('abort', cancel); page?.cleanup();
          }
        },
      };
    } catch (error) {
      dispose(); if (signal?.aborted) throw cancelled(); throw error;
    }
  }
  globalThis.OpenCabinetManualPDF = { isPS2, isJewelBooklet, supportsGame, dimensions, render, open };
})();
