const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm.cjs');

const source = fs.readFileSync('src/branding.js', 'utf8');
const previousPrefix = ['better', 'box'].join('');

test('Renaming preserves preferences, image selection and manual layouts without overwriting newer preferences', () => {
  const values = new Map([
    [`${previousPrefix}.preferences`, '{"maxCachedCovers":800}'],
    [`${previousPrefix}.imageTypes`, '{"cover":1}'],
    [`${previousPrefix}.manualCoverModes`, '{"7":"right"}'],
    [`${previousPrefix}.manualReadingModes`, '{"7":"booklet"}'],
    ['opencabinet.preferences', '{"maxCachedCovers":1000}'],
    ['another-app', 'unrelated'],
  ]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  vm.runInNewContext(source, { localStorage: storage });
  assert.equal(values.get('opencabinet.preferences'), '{"maxCachedCovers":1000}');
  for (const suffix of ['imageTypes', 'manualCoverModes', 'manualReadingModes']) {
    assert.equal(values.get(`opencabinet.${suffix}`), values.get(`${previousPrefix}.${suffix}`));
  }
  const before = [...values]; vm.runInNewContext(source, { localStorage: storage });
  assert.deepEqual([...values], before);
  assert.equal(values.get('another-app'), 'unrelated');
  assert.equal(values.get(`${previousPrefix}.preferences`), '{"maxCachedCovers":800}');
});

test('Preference migration works for a new profile and tolerates unavailable browser storage', () => {
  vm.runInNewContext(source, {});
  vm.runInNewContext(source, { localStorage: { getItem() { throw Error('Unavailable'); } } });
  vm.runInNewContext(source, { localStorage: { getItem: key => key.startsWith(`${previousPrefix}.`) ? '{}' : null,
    setItem() { throw Error('Read only'); } } });
});
