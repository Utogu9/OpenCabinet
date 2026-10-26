// Include PDF.js in Tauri's static frontend, so reading manuals works offline.
const fs = require('node:fs');
const path = require('node:path');
const source = path.dirname(require.resolve('pdfjs-dist/package.json'));
const destination = path.resolve(__dirname, '../src/vendor/pdfjs');
fs.mkdirSync(destination, { recursive: true });
// Preserve unchanged assets so Tauri's dev server does not reload the whole app
// when preparing PDF.js again. Compare bytes too, to repair incomplete copies.
function needsCopy(from, to) {
  if (fs.statSync(from).isDirectory() || !fs.existsSync(to)) return true;
  return fs.statSync(from).size !== fs.statSync(to).size
    || !fs.readFileSync(from).equals(fs.readFileSync(to));
}
for (const filename of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  const from = path.join(source, 'build', filename), to = path.join(destination, filename);
  if (needsCopy(from, to)) fs.copyFileSync(from, to);
}
for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  fs.cpSync(path.join(source, folder), path.join(destination, folder), { recursive: true, filter: needsCopy });
}
if (needsCopy(path.join(source, 'LICENSE'), path.join(destination, 'LICENSE'))) {
  fs.copyFileSync(path.join(source, 'LICENSE'), path.join(destination, 'LICENSE'));
}
console.log('PDF.js preparado para lectura local de manuales.');
