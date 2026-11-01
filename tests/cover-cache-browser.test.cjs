const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');

test('Workers keep each cover attached to the correct game through batch loads and cached grid rebuilds', async t => {
  let chromium; try { ({ chromium } = require('playwright-core')); } catch { t.skip('Optional browser test requires playwright-core.'); return; }
  const executable = process.env.OPENCABINET_CHROMIUM || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : chromium.executablePath());
  if (!fs.existsSync(executable)) { t.skip('Chromium is not installed.'); return; }
  const root = path.resolve(__dirname, '../src');
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    if (name === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><meta charset="utf-8"><title>Thumbnail fixture</title>'); return; }
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, bytes) => { if (error) { res.writeHead(404).end(); return; } res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(bytes); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const browser = await chromium.launch({ executablePath: executable, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(() => { window.OpenCabinetI18n = { t: key => key }; });
  await page.addScriptTag({ url: '/cover-cache.js' });
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'helpers/cover-cache-browser.js'), 'utf8') });
  for (const transferPixels of [false, true]) {
    const result = await page.evaluate(transferPixels => checkCoverCachePixels({ transferPixels, imageCache: transferPixels }), transferPixels);
    assert.deepEqual(result.cold, [], 'Newly generated covers retain their pixels');
    assert.deepEqual(result.rebuilt, [], 'Reordering the grid must not swap or blank covers');
    assert.deepEqual(result.restored, [], 'Persisted thumbnails retain their pixels');
    assert.equal(result.writes, result.count, 'Restoring must reuse compressed thumbnails');
    assert.ok(result.reads > 0);
  }
});
