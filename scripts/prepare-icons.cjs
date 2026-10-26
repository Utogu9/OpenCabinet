const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src/assets/OpenCabinetLogo.webp');
const generated = path.join(root, 'target/opencabinet-icons');
const destination = path.join(root, 'src-tauri/icons');

// Stage the full Tauri output, then publish only the desktop icons we use.
// Contain preserves the proportions of a non-square logo without cropping it.
const result = spawnSync(process.execPath, [
  path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'),
  'icon', source, '--fit', 'contain', '--output', generated,
], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const icons = fs.readdirSync(destination, { withFileTypes: true })
  .filter(entry => entry.isFile() && /\.(png|ico|icns)$/i.test(entry.name))
  .map(entry => entry.name);
for (const name of icons) {
  if (!fs.existsSync(path.join(generated, name))) throw new Error(`Missing generated icon: ${name}`);
}
for (const name of icons) fs.copyFileSync(path.join(generated, name), path.join(destination, name));
console.log(`Updated ${icons.length} desktop icons from OpenCabinetLogo.webp.`);
