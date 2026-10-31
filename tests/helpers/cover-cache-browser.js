// Executed inside Chromium or the real Tauri/WebKitGTK webview.
globalThis.checkCoverCachePixels = async function ({ transferPixels = window.OpenCabinetRuntime?.linux === true } = {}) {
  const api = window.OpenCabinetCovers, stored = new Map(), urls = [], originals = [];
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:999999;background:#111;display:grid;grid-template-columns:repeat(8,70px);grid-auto-rows:90px;align-content:start';
  document.body.append(root);
  const pause = () => new Promise(resolve => setTimeout(resolve, 30));
  const until = async (predicate, stage = 'drawing') => {
    const start = performance.now();
    while (!predicate()) { if (performance.now() - start > 20000) throw Error(`Thumbnail test timed out (${stage}; stored=${stored.size}; errors=${errors.join('; ')})`); await pause(); }
  };
  const color = index => [25 + index * 53 % 200, 25 + index * 97 % 200, 25 + index * 139 % 200];
  let loader, cache, decoder;
  let reads = 0, writes = 0; const errors = [];
  try {
    for (let index = 0; index < 48; index++) {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 560;
      const context = canvas.getContext('2d'); context.fillStyle = `rgb(${color(index)})`; context.fillRect(0, 0, 400, 560);
      context.fillStyle = `rgb(${color(index + 51)})`; context.fillRect(0, 280, 400, 280);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      originals.push(URL.createObjectURL(blob)); urls.push(originals[index]);
    }
    function start() {
      decoder = api.createDecoder({ transferPixels });
      const persistent = api.createPersistentDecoder({ decode: decoder, toUrl: path => path,
        lookup: async source => { const item = stored.get(source); if (item) reads++; return { cached: !!item, key: source, path: item || source }; },
        onError: error => errors.push(String(error)),
        store: async (source, key, bytes) => {
          const url = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }));
          urls.push(url); stored.set(source, url); writes++;
        },
      });
      cache = api.createCache(12, persistent);
    }
    function grid(order) {
      loader?.dispose(); root.replaceChildren();
      loader = api.createLoader(root, cache, { prefetchAll: true });
      for (const index of order) {
        const card = document.createElement('div'); card.dataset.coverIndex = index;
        card.style.cssText = 'width:60px;height:84px'; root.append(card);
        loader.observe(card, originals[index], `Game ${index}`, 'fixture-cover');
      }
      loader.start();
    }
    async function inspect() {
      const failures = [];
      for (const card of root.children) {
        card.scrollIntoView({ block: 'nearest' });
        await until(() => !!card.querySelector('canvas'));
        const canvas = card.querySelector('canvas'), context = canvas.getContext('2d');
        const index = Number(card.dataset.coverIndex);
        for (const [y, expected] of [[5, color(index)], [Math.floor(canvas.height * .75), color(index + 51)]]) {
          const pixel = [...context.getImageData(5, y, 1, 1).data];
          if (pixel[3] < 250 || expected.some((component, channel) => Math.abs(component - pixel[channel]) > 12)) {
            failures.push({ index, y, expected, pixel });
          }
        }
      }
      return failures;
    }
    const order = originals.map((_, index) => index);
    start(); grid(order);
    await until(() => stored.size === originals.length, 'persisting thumbnails');
    const cold = await inspect();
    grid([...order].reverse()); const rebuilt = await inspect();
    loader.dispose(); cache.dispose(); start(); grid(order);
    const restored = await inspect();
    return { count: originals.length, cold, rebuilt, restored, reads, writes };
  } finally {
    loader?.dispose(); cache?.dispose(); root.remove(); urls.forEach(url => URL.revokeObjectURL(url));
  }
};
