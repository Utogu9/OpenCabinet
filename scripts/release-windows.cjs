const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TAG = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$/;
function readJson(root, file) { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
function versionInToml(section) {
  const version = section?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error('Cannot read the application version in a Cargo manifest or lockfile.');
  return version;
}

function verifyVersions(root, tag) {
  if (!TAG.test(tag || '')) throw new Error('Expected a version tag such as v0.1.0 or v0.1.0-beta.1.');
  const version = tag.slice(1);
  const pkg = readJson(root, 'package.json');
  const lock = readJson(root, 'package-lock.json');
  const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8').split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
  const locked = fs.readFileSync(path.join(root, 'src-tauri/Cargo.lock'), 'utf8').split('[[package]]')
    .find(section => /^name\s*=\s*"opencabinet"\s*$/m.test(section));
  const versions = {
    'package.json': pkg.version,
    'package-lock.json': lock.version,
    'package-lock.json packages[""]': lock.packages?.['']?.version,
    'src-tauri/tauri.conf.json': readJson(root, 'src-tauri/tauri.conf.json').version,
    'src-tauri/Cargo.toml': versionInToml(cargo),
    'src-tauri/Cargo.lock': versionInToml(locked),
  };
  const mismatches = Object.entries(versions).filter(([, actual]) => actual !== version);
  if (mismatches.length) throw new Error(`Tag ${tag} does not match: ${mismatches.map(([file, actual]) => `${file}=${actual}`).join(', ')}`);
  return { version, prerelease: tag.includes('-') };
}

function emptyDirectory(directory) {
  if (fs.existsSync(directory) && fs.readdirSync(directory).length) throw new Error(`Refusing to replace a nonempty output directory: ${directory}`);
  fs.mkdirSync(directory, { recursive: true });
}

function stageWindowsArtifacts(root, tag, currentRepository = process.env.GITHUB_REPOSITORY) {
  const { version } = verifyVersions(root, tag);
  const config = readJson(root, 'src-tauri/tauri.conf.json');
  const endpoint = config.plugins?.updater?.endpoints?.[0];
  const repository = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/latest\/download\/latest\.json$/.exec(endpoint || '')?.[1];
  if (!repository || !config.plugins.updater.pubkey || config.bundle?.createUpdaterArtifacts !== true) {
    throw new Error('Configure the signed updater and its GitHub release endpoint before staging.');
  }
  if (currentRepository && currentRepository.toLowerCase() !== repository.toLowerCase()) {
    throw new Error('GITHUB_REPOSITORY does not match the configured updater endpoint.');
  }
  const release = path.join(root, 'src-tauri/target/x86_64-pc-windows-msvc/release');
  const executable = path.join(release, 'opencabinet.exe');
  const nsis = path.join(release, 'bundle/nsis');
  const installers = fs.readdirSync(nsis).filter(name => name.endsWith('.exe'));
  if (installers.length !== 1) throw new Error(`Expected exactly one NSIS installer, found ${installers.length}.`);
  const signaturePath = path.join(nsis, installers[0] + '.sig');
  const signature = fs.readFileSync(signaturePath, 'utf8').trim();
  if (!signature || !/^[A-Za-z0-9+/=\r\n]+$/.test(signature)) throw new Error('Missing or invalid updater signature.');
  if (config.plugins.updater.requireSignedVersion) {
    const comment = Buffer.from(signature, 'base64').toString('utf8').split(/\r?\n/)
      .find(line => line.startsWith('trusted comment:')) || '';
    if (!comment.split('\t').includes(`version:${version}`)) {
      throw new Error('The updater signature must be bound to the release version. Update the Tauri CLI and rebuild.');
    }
  }
  const notes = fs.readFileSync(path.join(root, '.github/release-notes.md'), 'utf8').trim();
  const assets = path.join(root, 'target/release-assets');
  const portable = path.join(root, 'target/release-portable/OpenCabinet');
  const copies = [
    [executable, path.join(portable, 'opencabinet.exe')],
    [path.join(nsis, installers[0]), path.join(assets, `OpenCabinet_${tag}_windows_x64_setup.exe`)],
    [signaturePath, path.join(assets, `OpenCabinet_${tag}_windows_x64_setup.exe.sig`)],
    ...['LICENSE', 'THIRD_PARTY_NOTICES.md'].map(name => [path.join(root, name), path.join(portable, name)]),
    [path.join(root, '.github/portable-readme.txt'), path.join(portable, 'README.txt')],
  ];
  const pdf = path.join(root, 'src/vendor/pdfjs');
  if (!fs.existsSync(path.join(pdf, 'LICENSE'))) throw new Error('PDF.js assets are missing; run npm ci first.');
  for (const directory of ['', 'cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    const source = path.join(pdf, directory);
    if (!fs.existsSync(source)) continue;
    for (const name of fs.readdirSync(source)) {
      if (/^(LICENSE|NOTICE)(?:[_.-]|$)/i.test(name) && fs.statSync(path.join(source, name)).isFile()) {
        copies.push([path.join(source, name), path.join(portable, 'third-party/pdfjs', directory, name)]);
      }
    }
  }
  // Validate all inputs before creating any distribution files. Never copy a
  // whole build directory: it can contain databases and other local user data.
  for (const [source] of copies) if (!fs.statSync(source).isFile()) throw new Error(`Not a file: ${source}`);
  for (const binary of [executable, path.join(nsis, installers[0])]) {
    const handle = fs.openSync(binary, 'r');
    const magic = Buffer.alloc(2);
    try { fs.readSync(handle, magic); } finally { fs.closeSync(handle); }
    if (magic.toString() !== 'MZ') throw new Error(`Not a Windows executable: ${binary}`);
  }
  emptyDirectory(assets);
  emptyDirectory(portable);
  for (const [source, destination] of copies) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
  const manifest = {
    version, notes,
    pub_date: new Date().toISOString(),
    platforms: { 'windows-x86_64': {
      signature,
      url: `https://github.com/${repository}/releases/download/${tag}/OpenCabinet_${tag}_windows_x64_setup.exe`,
    } },
  };
  fs.writeFileSync(path.join(assets, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { assets, portable };
}

function writeChecksums(root, tag) {
  verifyVersions(root, tag);
  const directory = path.join(root, 'target/release-assets');
  const names = [`OpenCabinet_${tag}_windows_x64_setup.exe`, `OpenCabinet_${tag}_windows_x64_setup.exe.sig`,
    `OpenCabinet_${tag}_windows_x64_portable.zip`, 'latest.json'].sort();
  const sums = names.map(name => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')}  ${name}`);
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
  return names;
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const tag = process.env.RELEASE_TAG;
    const command = process.argv[2];
    if (command === 'verify') {
      const result = verifyVersions(root, tag);
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\nprerelease=${result.prerelease}\n`);
      console.log(`Verified OpenCabinet ${tag}.`);
    } else if (command === 'stage') {
      console.log(stageWindowsArtifacts(root, tag));
    } else if (command === 'checksums') {
      console.log(writeChecksums(root, tag));
    } else throw new Error('Use verify, stage or checksums.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { verifyVersions, stageWindowsArtifacts, writeChecksums };
