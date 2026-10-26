const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/app-updates.js'), 'utf8');
const offer = { version: '0.2.0', notes: 'Changes', install_allowed: true };
function fixture(invoke, busy = () => false) {
  const context = vm.createContext({}); vm.runInContext(source, context);
  const rendered = [], notifications = [], channels = [];
  const controller = context.OpenCabinetUpdates.create({ invoke, busy,
    channel: () => { const channel = {}; channels.push(channel); return channel; },
    render: state => rendered.push(state), notify: version => notifications.push(version) });
  return { controller, rendered, notifications, channels };
}

test('Update checks offer a version but never download or install automatically', async () => {
  const calls = [];
  const { controller, notifications } = fixture(async command => { calls.push(command); return offer; });
  await controller.check(true);
  assert.deepEqual(calls, ['check_app_update']);
  assert.equal(controller.state.phase, 'available');
  assert.deepEqual(notifications, ['0.2.0']);
});

test('Missing release or offline startup stays quiet; a manual retry reports the error', async () => {
  const { controller } = fixture(async () => { throw Error('Offline'); });
  await controller.check(true);
  assert.equal(controller.state.phase, 'idle');
  assert.equal(controller.state.error, '');
  await controller.check();
  assert.equal(controller.state.phase, 'error');
  assert.match(controller.state.error, /Offline/);
});

test('No update clears a previous offer and concurrent checks are coalesced', async () => {
  let complete, calls = 0;
  const { controller } = fixture(() => { calls++; return new Promise(resolve => { complete = resolve; }); });
  const pending = controller.check();
  await controller.check(); assert.equal(calls, 1);
  complete(offer); await pending;
  const retry = controller.check(); complete(null); await retry;
  assert.equal(controller.state.phase, 'current'); assert.equal(controller.state.update, null);
});

test('One click downloads with progress, locks duplicate actions, then starts installation', async () => {
  let finish;
  const calls = [];
  const { controller, channels } = fixture(async (command, args) => {
    calls.push(command);
    if (command === 'check_app_update') return offer;
    assert.equal(args.version, offer.version);
    return new Promise(resolve => { finish = resolve; });
  });
  await controller.check();
  const pending = controller.install();
  assert.equal(controller.busy, true);
  channels[0].onmessage({ phase: 'downloading', downloaded: 512, total: 1024 });
  assert.equal(controller.state.downloaded, 512);
  await controller.install(); await controller.check();
  assert.deepEqual(calls, ['check_app_update', 'install_app_update']);
  channels[0].onmessage({ phase: 'installing', downloaded: 1024, total: 1024 });
  assert.equal(controller.state.phase, 'installing');
  finish(); await pending;
});

test('Failed verification/installation permits retry and ignores late progress', async () => {
  const { controller, channels } = fixture(async command => {
    if (command === 'check_app_update') return offer;
    throw Error('Invalid signature');
  });
  await controller.check(); await controller.install();
  assert.equal(controller.busy, false); assert.equal(controller.state.phase, 'available');
  assert.match(controller.state.error, /Invalid signature/);
  channels[0].onmessage({ phase: 'installing', downloaded: 1, total: 1 });
  assert.equal(controller.state.phase, 'available');
  await controller.install(); assert.equal(channels.length, 2);
});

test('Active games/imports and development builds cannot install updates', async () => {
  const calls = [];
  const { controller } = fixture(async command => { calls.push(command); return offer; }, () => true);
  await controller.check(); await controller.install();
  assert.equal(controller.state.error, 'update.finishTasks');
  assert.deepEqual(calls, ['check_app_update']);
  const dev = fixture(async () => ({ ...offer, install_allowed: false }));
  await dev.controller.check(); await dev.controller.install();
  assert.equal(dev.channels.length, 0);
});
