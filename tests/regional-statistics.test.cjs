const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm.cjs');

function app(storage = new Map(), failSave = false) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { dataset: {}, attributes: {}, handlers: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(key, action) { this.handlers[key] = action; } });
    return elements.get(id);
  };
  const context = vm.createContext({ document: { getElementById: get }, window: {
    __TAURI__: { core: { invoke() {} } }, addEventListener() {},
    localStorage: { getItem: key => storage.get(key), setItem(key, value) {
      if (failSave) throw Error('Unavailable'); storage.set(key, value);
    } },
  } });
  const evaluate = code => vm.runInContext(code, context);
  evaluate(fs.readFileSync('src/main.js', 'utf8'));
  evaluate(`renderPlatformFilters = () => {}; applyLibraryFilters = () => {};
    showToast = () => {}; updatePlayStatus = () => {}; updatePlatformStatistics = () => {};
    allGames = [{id:1, title:'Regional title', default_region_id:2,
      play_time_seconds:720, session_count:5, last_played:'2026-10-21T10:00:00Z', is_running:false,
      regions:[
        {label:'Europa',game:{id:1,title:'Original title',play_time_seconds:120,session_count:2,last_played:'2026-10-20T10:00:00Z'}},
        {label:'USA',game:{id:2,title:'Regional title',play_time_seconds:600,session_count:3,last_played:'2026-10-21T10:00:00Z'}}
      ]}]; allGames.forEach(projectRegionalStatistics);`);
  return { evaluate, get, storage, toggle: () => evaluate('preferences.combineRegionStatistics = !preferences.combineRegionStatistics; allGames.forEach(projectRegionalStatistics);'),
    stats: () => JSON.parse(evaluate('JSON.stringify(playStatisticsSnapshot(allGames[0]))')) };
}

test('Regional statistics default to totals and select only the default edition when disabled', () => {
  const ui = app();
  assert.equal(ui.stats().play_time_seconds, 720);
  ui.toggle(); assert.equal(ui.stats().play_time_seconds, 600);
  assert.equal(ui.stats().session_count, 3);
  const restarted = ui;
  restarted.evaluate('allGames[0].default_region_id=1; projectRegionalStatistics(allGames[0]);');
  assert.equal(restarted.stats().play_time_seconds, 120);
  assert.equal(restarted.stats().last_played, '2026-10-20T10:00:00Z');
  restarted.toggle(); assert.equal(restarted.stats().play_time_seconds, 720);
  assert.equal(restarted.stats().session_count, 5);
});

test('Live statistics update the executed edition, preserve independent totals and reject late launch responses', () => {
  const ui = app(); ui.toggle();
  ui.evaluate(`applyPlayStatistics({id:1,play_time_seconds:740,session_count:6,last_played:'2026-10-22T10:00:00Z',is_running:true,
    region_statistics:[{id:1,play_time_seconds:140,session_count:3,last_played:'2026-10-22T10:00:00Z',is_running:true},
      {id:2,play_time_seconds:600,session_count:3,last_played:'2026-10-21T10:00:00Z',is_running:false}]});`);
  assert.equal(ui.stats().play_time_seconds, 600);
  assert.equal(ui.stats().session_count, 3);
  assert.equal(ui.stats().is_running, true);
  ui.toggle(); assert.equal(ui.stats().play_time_seconds, 740);
  ui.evaluate(`applyPlayStatistics({id:1,play_time_seconds:730,session_count:6,is_running:true});`);
  assert.equal(ui.stats().play_time_seconds, 740);
  ui.evaluate(`applyPlayStatistics({id:1,play_time_seconds:740,session_count:6,last_played:'2026-10-22T10:00:00Z',is_running:false});
    applyPlayStatistics({id:1,play_time_seconds:740,session_count:6,is_running:true});`);
  assert.equal(ui.stats().is_running, false);
  ui.toggle(); assert.equal(ui.stats().last_played, '2026-10-21T10:00:00Z');
  ui.evaluate('allGames[0].default_region_id=1; projectRegionalStatistics(allGames[0]);');
  assert.equal(ui.stats().play_time_seconds, 140);
  assert.equal(ui.stats().session_count, 3);
});

