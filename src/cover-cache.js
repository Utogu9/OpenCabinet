// Decoded thumbnails are shared across library filters. Originals are only used
// while preparing a thumbnail; the cache never retains full-size cover images.
(() => {
  const scriptSource = globalThis.document?.currentScript?.src;
  const workerUrl = scriptSource ? new URL('cover-worker.js', scriptSource) : 'cover-worker.js';
  function abortError() {
    const error = new Error(globalThis.OpenCabinetI18n.t("msg.d1a690f5b6"));
    error.name = "AbortError";
    return error;
  }

  function createDecoder({ transferPixels = window.OpenCabinetRuntime?.linux === true,
    encodePixels = window.__TAURI__?.core?.invoke ? async ({ pixels, width, height }) => new Uint8Array(
      await window.__TAURI__.core.invoke('encode_cover_thumbnail', pixels, {
        headers: { 'x-thumbnail-width': String(width), 'x-thumbnail-height': String(height) },
      })) : null } = {}) {
    let worker = null;
    let workerUnavailable = false;
    let nextId = 0;
    const requests = new Map();

    async function finishPreview(bitmap, persist, fullCover, bytes = null, pixels = null) {
      if (!persist && !fullCover) return;
      // Browser encoders silently fall back to PNG when WebP is unsupported.
      // The native encoder preserves the WebP cache format and quality.
      if (!bytes && encodePixels) {
        let canvas = bitmap, temporary = false;
        try {
          if (!pixels) {
            canvas = document.createElement('canvas'); temporary = true;
            canvas.width = bitmap.width; canvas.height = bitmap.height;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(bitmap, 0, 0);
            pixels = context.getImageData(0, 0, canvas.width, canvas.height).data.buffer;
          }
          bytes = await encodePixels({ pixels, width: bitmap.width, height: bitmap.height });
        } catch { /* A preview still works in RAM when encoding fails. */ }
        finally { if (temporary) canvas.width = canvas.height = 0; }
      }
      if (!bytes) return;
      // Keep already-encoded bytes for 3D/CSS consumers too. Reusing this blob
      // avoids encoding the decoded RAM thumbnail again on the UI thread.
      bitmap.previewBlob = new Blob([bytes], { type: 'image/webp' });
      bitmap.previewSize = { width: bitmap.width, height: bitmap.height };
      try { if (persist) await persist(bytes); }
      catch { /* A cache write must never prevent displaying the cover. */ }
    }

    function getWorker() {
      if (worker || workerUnavailable) return worker;
      try {
        worker = new Worker(workerUrl);
        worker.onmessage = async ({ data }) => {
          const request = requests.get(data.id);
          if (!request) { data.bitmap?.close(); return; }
          requests.delete(data.id);
          let bitmap = data.bitmap;
          try {
            if (data.pixels) {
              // WebKitGTK must own a separate pixel buffer for each thumbnail.
              // Do not retain transferred GPU-backed ImageBitmaps on Linux.
              bitmap = document.createElement("canvas"); bitmap.width = data.width; bitmap.height = data.height;
              bitmap.getContext("2d", { willReadFrequently: true }).putImageData(
                new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height), 0, 0);
              bitmap.close = () => { bitmap.width = bitmap.height = 0; };
            }
            if (!bitmap) throw new Error(data.error);
            await finishPreview(bitmap, request.persist, request.fullCover, data.thumbnailBytes, data.pixels);
            request.resolve(bitmap);
          } catch (error) { bitmap?.close?.(); request.reject(error); }
        };
        worker.onerror = (event) => {
          event.preventDefault();
          worker.terminate();
          worker = null;
          workerUnavailable = true;
          for (const request of requests.values()) request.reject(new Error(globalThis.OpenCabinetI18n.t("msg.4771ff7077")));
          requests.clear();
        };
      } catch {
        workerUnavailable = true;
      }
      return worker;
    }

    async function fallback(url, signal, persist, fullCover, maxEdge) {
      const image = document.createElement("img");
      image.decoding = "async";
      image.loading = "eager";
      let rejectLoad;
      const cancel = () => { rejectLoad?.(abortError()); image.removeAttribute("src"); };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        await new Promise((resolve, reject) => {
          rejectLoad = reject;
          image.onload = resolve;
          image.onerror = reject;
          image.src = url;
        });
        if (image.decode) await image.decode();
        if (signal.aborted) throw abortError();
        const scale = Math.min(1, (maxEdge || (fullCover ? 1280 : 320)) / image.naturalWidth, (maxEdge || (fullCover ? 800 : 400)) / image.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext("2d", { willReadFrequently: transferPixels }).drawImage(image, 0, 0, canvas.width, canvas.height);
        if (persist || fullCover) {
          let bytes = null;
          try {
            const blob = canvas.toBlob && await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.9));
            if (blob?.type === "image/webp" && !signal.aborted) {
              bytes = new Uint8Array(await blob.arrayBuffer());
            }
          } catch { /* Images without CORS can still be displayed in RAM. */ }
          if (!signal.aborted) await finishPreview(canvas, persist, fullCover, bytes);
        }
        canvas.close = () => { canvas.width = canvas.height = 0; };
        return canvas;
      } finally {
        signal.removeEventListener("abort", cancel);
        image.onload = image.onerror = null;
        image.removeAttribute("src");
      }
    }

    async function decode(url, signal, persist = null, { fullCover = false, maxEdge = null } = {}) {
      if (signal.aborted) throw abortError();
      maxEdge = Number.isFinite(maxEdge) && maxEdge > 0 ? Math.min(4096, Math.round(maxEdge)) : null;
      const currentWorker = getWorker();
      if (!currentWorker) return fallback(url, signal, persist, fullCover, maxEdge);
      const id = ++nextId;
      const cancel = () => {
        currentWorker.postMessage({ cancel: id });
        requests.get(id)?.reject(abortError());
        requests.delete(id);
      };
      try {
        return await new Promise((resolve, reject) => {
          requests.set(id, { resolve, reject, persist, fullCover });
          signal.addEventListener("abort", cancel, { once: true });
          currentWorker.postMessage({ locale: globalThis.OpenCabinetI18n.locale, id, url, encode: Boolean(persist), fullCover, maxEdge, transferPixels });
        });
      } catch (error) {
        if (signal.aborted) throw abortError();
        // Some remote images lack CORS headers. They can still be displayed
        // through an img without reading/exporting its canvas pixels.
        return fallback(url, signal, persist, fullCover, maxEdge);
      } finally {
        requests.delete(id);
        signal.removeEventListener("abort", cancel);
      }
    }
    decode.dispose = () => {
      worker?.terminate();
      worker = null;
      for (const request of requests.values()) request.reject(abortError());
      requests.clear();
    };
    return decode;
  }

  // Disk stores compressed thumbnails; a bounded RAM layer still keeps the
  // visible/recent decoded bitmaps. Disk capacity never limits prefetching.
  function createImageDecoder() {
    return async (url, signal, unused = null, { fullCover = false } = {}) => {
      if (signal.aborted) throw abortError();
      const image = document.createElement('img');
      image.decoding = 'async'; image.loading = 'eager'; image.crossOrigin = 'anonymous'; image.previewImage = true;
      let rejectLoad;
      const cancel = () => { image.removeAttribute('src'); rejectLoad?.(abortError()); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        await new Promise((resolve, reject) => { rejectLoad = reject; image.onload = resolve; image.onerror = reject; image.src = url; });
        if (image.decode) await image.decode();
        if (signal.aborted) throw abortError();
        if (fullCover) {
          const response = await fetch(url, { signal });
          if (response.ok) { image.previewBlob = await response.blob(); image.previewSize = { width: image.naturalWidth, height: image.naturalHeight }; }
        }
        image.close = () => image.removeAttribute('src');
        return image;
      } catch (error) { image.removeAttribute('src'); throw error; }
      finally { image.onload = image.onerror = null; signal.removeEventListener('abort', cancel); }
    };
  }

  function createPersistentDecoder({ decode, decodeCached = decode, lookup, store, toUrl, optionsFor = () => ({}), onError = () => {} }) {
    const persistent = async (path, signal) => {
      let entry;
      try { entry = await lookup(path); }
      catch (error) { onError(error); }
      if (signal.aborted) throw abortError();
      if (entry?.cached) {
        try { return await decodeCached(toUrl(entry.path), signal, null, optionsFor(path)); }
        catch (error) { if (signal.aborted) throw abortError(); }
      }
      const persist = entry ? async thumbnailBytes => {
        if (signal.aborted) return;
        try { await store(path, entry.key, thumbnailBytes); }
        catch (error) { onError(error); }
      } : null;
      return decode(toUrl(path), signal, persist, optionsFor(path));
    };
    persistent.dispose = () => decode.dispose?.();
    return persistent;
  }

  function createCache(limit, decode) {
    const ready = new Map();
    const pending = new Map();
    let disposed = false;
    let protectedPaths = new Set();
    function trim(keep = null) {
      for (const [path, task] of pending) if (task.signal.aborted) pending.delete(path);
      while (ready.size && ready.size + pending.size > limit) {
        const keys=[...ready.keys()];
        const path=keys.find(key=>key!==keep&&!protectedPaths.has(key)) ?? keys.find(key=>key!==keep);
        if(path===undefined)break;
        ready.get(path).close();
        ready.delete(path);
      }
    }
    const cache = {
      get limit() { return limit; },
      get size() { return ready.size; },
      protect(paths) { protectedPaths = paths; },
      get(path) {
        const bitmap = ready.get(path);
        if (bitmap) { ready.delete(path); ready.set(path, bitmap); }
        return bitmap;
      },
      setLimit(value) { limit = value; trim(); },
      put(path, bitmap) {
        if (disposed) { bitmap.close(); return; }
        const previous=ready.get(path);
        if(previous && previous!==bitmap)previous.close();
        ready.delete(path);ready.set(path,bitmap);trim(path);
      },
      invalidate(path) {
        const task = pending.get(path);
        if (task) { task.invalidated = true; pending.delete(path); }
        ready.get(path)?.close();
        ready.delete(path);
      },
      load(path, signal, decoder = decode) {
        if (signal.aborted || disposed) return Promise.reject(abortError());
        const cached = cache.get(path);
        if (cached) return Promise.resolve(cached);
        const previous = pending.get(path);
        if (previous && !previous.signal.aborted) return previous.promise;
        const task = { signal };
        task.promise = Promise.resolve().then(() => decoder(path, signal)).then((bitmap) => {
          if (signal.aborted || disposed || task.invalidated) { bitmap.close(); throw abortError(); }
          if (pending.get(path) === task) pending.delete(path);
          cache.put(path, bitmap);
          return bitmap;
        }).finally(() => {
          if (pending.get(path) === task) pending.delete(path);
        });
        pending.set(path, task);
        trim();
        return task.promise;
      },
      dispose() {
        disposed = true;
        for (const bitmap of ready.values()) bitmap.close();
        ready.clear();
        decode.dispose?.();
      },
    };
    return cache;
  }

  function createLoader(root, cache, options = {}) {
    const records = new Map();
    const byPath = new Map();
    const visibleCounts = new Map();
    const urgent = new Set();
    const loading = new Set();
    const failed = new Set();
    const controllers = new Set();
    let background = [];
    let cursor = 0;
    let active = 0;
    let disposed = false;
    let scrolling = false;
    let scrollTimer = null;
    let workTimer = null;

    function show(record, bitmap) {
      if (!record.visible || !record.container.isConnected || record.canvas) return;
      const canvas = bitmap.previewImage ? bitmap.cloneNode(false) : document.createElement("canvas");
      if (!bitmap.previewImage) { canvas.width = bitmap.width; canvas.height = bitmap.height; }
      canvas.className = record.className;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", record.title);
      if (bitmap.previewImage) canvas.alt = record.title;
      else canvas.getContext("2d", { willReadFrequently: window.OpenCabinetRuntime?.linux === true }).drawImage(bitmap, 0, 0);
      record.container.style.setProperty("--cover-ratio", String(bitmap.width / bitmap.height));
      record.container.classList.add("has-cover");
      record.canvas = canvas;
      record.container.replaceChildren(canvas);
    }
    function showError(record) {
      if (!record.visible || !record.container.isConnected) return;
      record.container.classList.remove("has-cover");
      const message = document.createElement("span");
      message.className = "image-unavailable";
      message.textContent = globalThis.OpenCabinetI18n.t("msg.cc5537794c");
      record.container.replaceChildren(message);
    }
    function schedule() {
      if (disposed || workTimer !== null) return;
      workTimer = setTimeout(() => { workTimer = null; pump(); }, 0);
    }
    function pump() {
      if (disposed || scrolling) return;
      while (active < Math.min(2, cache.limit)) {
        let path;
        if (urgent.size) {
          path = urgent.values().next().value;
          urgent.delete(path);
        } else if (cursor < background.length) path = background[cursor++];
        else return;
        const matching = (byPath.get(path) || []).filter((record) => record.container.isConnected);
        if ((!matching.length && !options.prefetchAll) || failed.has(path) || loading.has(path)) continue;
        const cached = cache.get(path);
        if (cached) { matching.forEach((record) => show(record, cached)); continue; }
        const controller = new AbortController();
        controllers.add(controller);
        loading.add(path);
        active++;
        cache.load(path, controller.signal).then((bitmap) => {
          if (!disposed) matching.forEach((record) => show(record, bitmap));
        }).catch((error) => {
          if (disposed || error.name === "AbortError") return;
          failed.add(path);
          matching.forEach(showError);
        }).finally(() => {
          controllers.delete(controller);
          loading.delete(path);
          active--;
          schedule();
        });
      }
    }

    const observer = new window.IntersectionObserver((entries) => {
      if (disposed) return;
      for (const entry of entries) {
        const record = records.get(entry.target);
        if (!record) continue;
        if (record.visible !== entry.isIntersecting) {
          const count = (visibleCounts.get(record.path) || 0) + (entry.isIntersecting ? 1 : -1);
          if (count) visibleCounts.set(record.path, count);
          else visibleCounts.delete(record.path);
        }
        record.visible = entry.isIntersecting;
        if (record.visible) {
          const bitmap = cache.get(record.path);
          if (bitmap) show(record, bitmap);
          else if (failed.has(record.path)) showError(record);
          else urgent.add(record.path);
        } else {
          if (record.canvas) {
            record.canvas.width = record.canvas.height = 0;
            record.canvas = null;
            record.container.classList.remove("has-cover");
            record.container.replaceChildren();
          }
          if (!visibleCounts.has(record.path)) urgent.delete(record.path);
        }
      }
      cache.protect(new Set(visibleCounts.keys()));
      schedule();
    }, { root, rootMargin: "200px 0px" });
    function onScroll() {
      scrolling = true;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => { scrolling = false; schedule(); }, 120);
    }
    root.addEventListener("scroll", onScroll, { passive: true });
    return {
      observe(container, path, title, className) {
        const record = { container, path, title, className, visible: false, canvas: null };
        records.set(container, record);
        if (!byPath.has(path)) byPath.set(path, []);
        byPath.get(path).push(record);
        observer.observe(container);
      },
      start() {
        // RAM prefetches one cacheful. Disk mode also prepares the remaining
        // library, while the decoded bitmap cache continues to use bounded LRU.
        const paths = [...new Set([...records.values()].map((record) => record.path).concat(options.paths || []))];
        background = options.prefetchAll ? paths : paths.slice(0, cache.limit);
        schedule();
      },
      dispose() {
        disposed = true;
        clearTimeout(scrollTimer);
        clearTimeout(workTimer);
        root.removeEventListener("scroll", onScroll);
        observer.disconnect();
        for (const controller of controllers) controller.abort();
        for (const record of records.values()) {
          if (record.canvas) record.canvas.width = record.canvas.height = 0;
        }
        records.clear();
        byPath.clear();
        visibleCounts.clear();
        cache.protect(new Set());
        urgent.clear();
        background = [];
      },
    };
  }

  window.OpenCabinetCovers = { createCache, createDecoder, createImageDecoder, createPersistentDecoder, createLoader };
})();
