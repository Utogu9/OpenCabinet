const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyVersions, stageWindowsArtifacts: stageRelease, writeChecksums } = require('../scripts/release-windows.cjs');
const stageWindowsArtifacts = (root, tag) => stageRelease(root, tag, 'Utogu9/OpenCabinet');

function fixture(t, version = '0.1.0') {
  const parent = path.resolve(__dirname, '../target/release-script-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'build-'));
  t.after(() => { assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  const write = (name, value) => {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'object' ? JSON.stringify(value) : value);
  };
  write('package.json', { version });
  write('package-lock.json', { version, packages: { '': { version } } });
  write('src-tauri/tauri.conf.json', { version, bundle: { createUpdaterArtifacts: true },
    plugins: { updater: { pubkey: 'public-key-fixture', requireSignedVersion: true,
      endpoints: ['https://github.com/Utogu9/OpenCabinet/releases/latest/download/latest.json'] } } });
  write('src-tauri/Cargo.toml', `[package]\nname = "opencabinet"\nversion = "${version}"\n\n[dependencies]\nother = "8.0.0"\n`);
  write('src-tauri/Cargo.lock', `[[package]]\nname = "dependency"\nversion = "9.0.0"\n[[package]]\nname = "opencabinet"\nversion = "${version}"\n`);
  const release = 'src-tauri/target/x86_64-pc-windows-msvc/release';
  write(`${release}/opencabinet.exe`, 'MZportable executable fixture');
  write(`${release}/bundle/nsis/OpenCabinet_setup.exe`, 'MZinstaller fixture');
  write(`${release}/bundle/nsis/OpenCabinet_setup.exe.sig`, Buffer.from(`untrusted comment: fixture\nsignature\ntrusted comment: file:setup.exe\tversion:${version}\nfixture`).toString('base64'));
  write(`${release}/data/private.db`, 'private library');
  write(`${release}/opencabinet.config.json`, 'private paths');
  write('LICENSE', 'Application license');
  write('THIRD_PARTY_NOTICES.md', 'Credits');
  write('.github/portable-readme.txt', 'Portable instructions');
  write('.github/release-notes.md', 'Release notes');
  write('src/vendor/pdfjs/LICENSE', 'PDF.js license');
  write('src/vendor/pdfjs/standard_fonts/LICENSE_FOXIT', 'Font license');
  write('src/vendor/pdfjs/standard_fonts/unused-font.pfb', 'font payload');
  return { root, write, release };
}

test('Release tags must match every version source and cannot contain refs or shell text', t => {
  const { root, write } = fixture(t);
  assert.deepEqual(verifyVersions(root, 'v0.1.0'), { version: '0.1.0', prerelease: false });
  for (const tag of ['main', 'v0.2.0', 'v01.0.0', 'v0.1.0\nextra', 'v0.1.0;echo bad', '../v0.1.0']) assert.throws(() => verifyVersions(root, tag));
  write('src-tauri/tauri.conf.json', { version: '0.2.0' });
  assert.throws(() => verifyVersions(root, 'v0.1.0'), /tauri.conf.json/);
});

test('Prerelease tags are recognized and stale root lockfile versions fail validation', t => {
  const { root, write } = fixture(t, '1.2.3-beta.1');
  assert.deepEqual(verifyVersions(root, 'v1.2.3-beta.1'), { version: '1.2.3-beta.1', prerelease: true });
  write('package-lock.json', { version: '1.2.3-beta.1', packages: { '': { version: '1.2.2' } } });
  assert.throws(() => verifyVersions(root, 'v1.2.3-beta.1'), /package-lock/);
});

test('Distribution staging copies only release binaries, instructions and notices', t => {
  const { root } = fixture(t);
  const { assets, portable } = stageWindowsArtifacts(root, 'v0.1.0');
  assert.deepEqual(fs.readdirSync(assets).sort(), ['OpenCabinet_v0.1.0_windows_x64_setup.exe', 'OpenCabinet_v0.1.0_windows_x64_setup.exe.sig', 'latest.json']);
  assert.deepEqual(fs.readdirSync(portable).sort(), ['LICENSE', 'README.txt', 'THIRD_PARTY_NOTICES.md', 'opencabinet.exe', 'third-party']);
  assert.equal(fs.readFileSync(path.join(portable, 'third-party/pdfjs/standard_fonts/LICENSE_FOXIT'), 'utf8'), 'Font license');
  assert.equal(fs.existsSync(path.join(portable, 'data')), false);
  assert.equal(fs.existsSync(path.join(portable, 'opencabinet.config.json')), false);
  assert.equal(fs.existsSync(path.join(portable, 'third-party/pdfjs/standard_fonts/unused-font.pfb')), false);
  assert.throws(() => stageWindowsArtifacts(root, 'v0.1.0'), /nonempty/);
});

test('The update feed includes the signed installer, version and Windows target', t => {
  const { root, write, release } = fixture(t);
  const { assets } = stageWindowsArtifacts(root, 'v0.1.0');
  const manifest = JSON.parse(fs.readFileSync(path.join(assets, 'latest.json'), 'utf8'));
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.notes, 'Release notes');
  assert.ok(Number.isFinite(Date.parse(manifest.pub_date)));
  assert.deepEqual(Object.keys(manifest.platforms), ['windows-x86_64']);
  assert.equal(manifest.platforms['windows-x86_64'].url, 'https://github.com/Utogu9/OpenCabinet/releases/download/v0.1.0/OpenCabinet_v0.1.0_windows_x64_setup.exe');
  assert.equal(manifest.platforms['windows-x86_64'].signature, fs.readFileSync(path.join(root, release, 'bundle/nsis/OpenCabinet_setup.exe.sig'), 'utf8'));
});

test('Unsigned builds cannot be staged or published', t => {
  const { root, release } = fixture(t);
  fs.unlinkSync(path.join(root, release, 'bundle/nsis/OpenCabinet_setup.exe.sig'));
  assert.throws(() => stageWindowsArtifacts(root, 'v0.1.0'));
  assert.equal(fs.existsSync(path.join(root, 'target/release-assets')), false);
});

test('Forks must configure their own update endpoint before publishing', t => {
  const { root } = fixture(t);
  assert.throws(() => stageRelease(root, 'v0.1.0', 'AnotherOwner/OpenCabinet'), /does not match/);
  assert.equal(fs.existsSync(path.join(root, 'target/release-assets')), false);
});

test('A signature from another release version cannot be staged', t => {
  const { root, write, release } = fixture(t);
  write(`${release}/bundle/nsis/OpenCabinet_setup.exe.sig`, Buffer.from('trusted comment: file:setup.exe\tversion:0.0.9').toString('base64'));
  assert.throws(() => stageWindowsArtifacts(root, 'v0.1.0'), /bound to the release version/);
  assert.equal(fs.existsSync(path.join(root, 'target/release-assets')), false);
});

test('Ambiguous installers or missing binaries never produce uploadable distribution files', t => {
  const { root, write, release } = fixture(t);
  write(`${release}/bundle/nsis/old_setup.exe`, 'MZolder installer');
  assert.throws(() => stageWindowsArtifacts(root, 'v0.1.0'), /exactly one/);
  assert.equal(fs.existsSync(path.join(root, 'target/release-assets')), false);
  fs.unlinkSync(path.join(root, release, 'bundle/nsis/old_setup.exe'));
  fs.unlinkSync(path.join(root, release, 'opencabinet.exe'));
  assert.throws(() => stageWindowsArtifacts(root, 'v0.1.0'));
  assert.equal(fs.existsSync(path.join(root, 'target/release-assets')), false);
});

test('Checksums cover the final installer and portable archive and reject incomplete output', t => {
  const { root, write } = fixture(t);
  const { assets } = stageWindowsArtifacts(root, 'v0.1.0');
  assert.throws(() => writeChecksums(root, 'v0.1.0'));
  assert.equal(fs.existsSync(path.join(assets, 'SHA256SUMS.txt')), false);
  write('target/release-assets/OpenCabinet_v0.1.0_windows_x64_portable.zip', 'portable archive fixture');
  const names = writeChecksums(root, 'v0.1.0');
  const expected = names.map(name => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(assets, name))).digest('hex')}  ${name}\n`).join('');
  assert.equal(fs.readFileSync(path.join(assets, 'SHA256SUMS.txt'), 'utf8'), expected);
});
