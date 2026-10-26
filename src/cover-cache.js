// Decoded thumbnails are shared across library filters. Originals are only used
// while preparing a thumbnail; the cache never retains full-size cover images.
(() => {
  function abortError() {
    const error = new Error(globalThis.OpenCabinetI18n.t("msg.d1a690f5b6"));
    error.name = "AbortError";
    return error;
  }

  function createDecoder() {
    let worker = null;
    let workerUnavailable = false;
    let nextId = 0;
    const requests = new Map();

    function getWorker() {
      if (worker || workerUnavailable) return worker;
      try {
        worker = new Worker("cover-worker.js");
        worker.onmessage = async ({ data }) => {
          const request = requests.get(data.id);
          if (!request) { data.bitmap?.close(); return; }
          requests.delete(data.id);
          if (data.bitmap) {
            if (request.fullCover && data.thumbnailBytes) {
              data.bitmap.previewBlob = new Blob([data.thumbnailBytes], { type: "image/webp" });
              data.bitmap.previewSize = { width: data.bitmap.width, height: data.bitmap.height };
            }
            try { if (data.thumbnailBytes && request.persist) await request.persist(data.thumbnailBytes); }
            catch { /* A cache write must never prevent displaying the cover. */ }
            request.resolve(data.bitmap);
          }
          else request.reject(new Error(data.error));
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

    async function fallback(url, signal, persist, fullCover) {
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
        const scale = Math.min(1, (fullCover ? 1280 : 320) / image.naturalWidth, (fullCover ? 800 : 400) / image.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        if ((persist || fullCover) && canvas.toBlob) {
          try {
            const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.9));
            if (blob?.type === "image/webp" && !signal.aborted) {
              if (fullCover) {
                canvas.previewBlob = blob;
                canvas.previewSize = { width: canvas.width, height: canvas.height };
              }
              if (persist) await persist(new Uint8Array(await blob.arrayBuffer()));
            }
          } catch { /* Images without CORS can still be displayed in RAM. */ }
        }
        canvas.close = () => { canvas.width = canvas.height = 0; };
        return canvas;
      } finally {
        signal.removeEventListener("abort", cancel);
        image.onload = image.onerror = null;
        image.removeAttribute("src");
      }
    }

    async function decode(url, signal, persist = null, { fullCover = false } = {}) {
      if (signal.aborted) throw abortError();
      const currentWorker = getWorker();
      if (!currentWorker) return fallback(url, signal, persist, fullCover);
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
          currentWorker.postMessage({ locale: globalThis.OpenCabinetI18n.locale, id, url, encode: Boolean(persist), fullCover });
        });
      } catch (error) {
        if (signal.aborted) throw abortError();
        // Some remote images lack CORS headers. They can still be displayed
        // through an img without reading/exporting its canvas pixels.
        return fallback(url, signal, persist, fullCover);
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
  function createPersistentDecoder({ decode, lookup, store, toUrl, optionsFor = () => ({}), onError = () => {} }) {
    const persistent = async (path, signal) => {
      let entry;
      try { entry = await lookup(path); }
      catch (error) { onError(error); }
      if (signal.aborted) throw abortError();
      if (entry?.cached) {
        try { return await decode(toUrl(entry.path), signal, null, optionsFor(path)); }
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
    function trim() {
      for (const [path, task] of pending) if (task.signal.aborted) pending.delete(path);
      while (ready.size && ready.size + pending.size > limit) {
        const path = [...ready.keys()].find((key) => !protectedPaths.has(key)) ?? ready.keys().next().value;
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
      invalidate(path) {
        ready.get(path)?.close();
        ready.delete(path);
      },
      load(path, signal) {
        if (signal.aborted || disposed) return Promise.reject(abortError());
        const cached = cache.get(path);
        if (cached) return Promise.resolve(cached);
        const previous = pending.get(path);
        if (previous && !previous.signal.aborted) return previous.promise;
        const task = { signal };
        task.promise = Promise.resolve().then(() => decode(path, signal)).then((bitmap) => {
          if (signal.aborted || disposed) { bitmap.close(); throw abortError(); }
          if (pending.get(path) === task) pending.delete(path);
          ready.set(path, bitmap);
          trim();
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
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.className = record.className;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", record.title);
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
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

  window.OpenCabinetCovers = { createCache, createDecoder, createPersistentDecoder, createLoader };
})();
