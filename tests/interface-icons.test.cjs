const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm.cjs');

test('Every interface icon is a bundled SVG with pinned provenance and a local CSS mask', () => {
  const source = JSON.parse(fs.readFileSync('src/assets/icons/sources.json', 'utf8'));
  const css = fs.readFileSync('src/styles.css', 'utf8');
  assert.match(source.revision, /^[a-f0-9]{40}$/);
  assert.ok(source.icons.length > 20);
  for (const name of source.icons) {
    const svg = fs.readFileSync(`src/assets/icons/${name}.svg`, 'utf8');
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.doesNotMatch(svg, /<script|<foreignObject|href=|url\(/i);
    assert.ok(css.includes(`url("assets/icons/${name}.svg")`), name);
  }
  assert.match(fs.readFileSync('src/assets/icons/LICENSE', 'utf8'), /Permission to use, copy, modify/);
  const html = fs.readFileSync('src/index.html', 'utf8');
  assert.ok(html.indexOf('src="ui-icons.js"') < html.indexOf('src="i18n.js"'));
});

test('Icons decorate marked interface labels, keeping native options and user metadata as text', () => {
  const context = vm.createContext({});
  const api = context.OpenCabinetI18n; api.setLocale('en-US');
  const make = tagName => ({ tagName, textContent: '', icon: false,
    getAttribute: () => 'msg.02f344eb6e', classList: { toggle(name, value) { this.value = value; } } });
  const label = make('SPAN'), option = make('OPTION');
  const metadata = { textContent: '🎮 <b>My game</b>' };
  api.translateDOM({ querySelectorAll: selector => selector === '[data-i18n]' ? [label, option] : [] });
  assert.equal(label.textContent, 'Edit game'); assert.equal(label.classList.value, true);
  assert.equal(option.textContent, 'Edit game'); assert.equal(option.classList.value, false);
  assert.equal(metadata.textContent, '🎮 <b>My game</b>');
  assert.match(context.OpenCabinetIcons.html('pencil'), /aria-hidden="true"/);
  assert.throws(() => context.OpenCabinetIcons.html('<img src=x onerror=alert(1)>'), /Unknown interface icon/);
});

test('Interface catalogs no longer require emoji fonts and the WebKit layer hint is Linux-specific', () => {
  for (const locale of ['es-AR', 'en-US']) {
    const { messages } = JSON.parse(fs.readFileSync(`src/locales/${locale}.json`, 'utf8'));
    for (const [key, value] of Object.entries(messages)) assert.doesNotMatch(value, /\p{Extended_Pictographic}/u, key);
  }
  assert.match(fs.readFileSync('src/styles.css', 'utf8'), /html\[data-os="linux"\] \.game-box-model \.game-box-face\s*\{ will-change: transform; \}/);
});
