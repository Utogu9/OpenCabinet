const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm.cjs');
const scope = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync('src/window-fullscreen.js','utf8'), scope);
const { create } = scope.module.exports;
const turn = () => new Promise(resolve => setImmediate(resolve));
function windowFixture({ maximized = true, fullscreen = false } = {}) {
  const app = require('./fixtures/native-window.cjs')({ maximized, fullscreen });
  const errors = [], service = create(app, { onError: error => errors.push(error) });
  return { app, service, errors };
}

test('Maximized and normal windows cover the monitor and restore their original state on close', async () => {
  for (const maximized of [true,false]) {
    const { app,service,errors } = windowFixture({ maximized });
    const lease = service.acquire(); await lease.ready;
    assert.equal(app.fullscreen,true); assert.equal(app.rectangle,'whole-monitor');
    assert.deepEqual(app.calls,['fullscreen:true'], 'enter without restoring or minimizing first');
    await lease.release(); assert.equal(app.fullscreen,false); assert.equal(app.maximized,maximized);
    assert.equal(app.rectangle,maximized ? 'work-area' : 'normal-bounds'); assert.deepEqual(app.calls,['fullscreen:true','fullscreen:false']); assert.equal(app.subscriptions,0); assert.deepEqual(errors,[]);
  }
});

test('Closing one viewer cannot leave fullscreen while a second viewer still owns it', async () => {
  const { app,service } = windowFixture();
  const box=service.acquire(), gallery=service.acquire(); await service.idle();
  await box.release(); assert.equal(app.fullscreen,true); assert.equal(app.maximized,false);
  await gallery.release(); assert.equal(app.fullscreen,false); assert.equal(app.maximized,true);
  assert.deepEqual(app.calls,['fullscreen:true','fullscreen:false']);
});

test('Closing before the initial window query completes does not enter fullscreen or change maximization', async () => {
  const { app,service }=windowFixture(); let finish;
  app.isFullscreen=()=>new Promise(resolve=>{finish=resolve;});
  const lease=service.acquire();await turn();lease.release();finish(false);await service.idle();
  assert.deepEqual(app.calls,[]);assert.equal(app.maximized,true);
});

test('A late fullscreen entry is restored after closing, but never restores over a newer viewer', async () => {
  for (const reopen of [false,true]) {
    const { app,service }=windowFixture();let finish;
    const setFullscreen=app.setFullscreen.bind(app);
    app.setFullscreen=async value=>{await setFullscreen(value);if(value)await new Promise(resolve=>{finish=resolve;});};
    const first=service.acquire();await turn();assert.ok(finish);first.release();
    const second=reopen?service.acquire():null;finish();await service.idle();
    assert.equal(app.fullscreen,reopen);
    if(second)await second.release();
    assert.equal(app.fullscreen,false);assert.equal(app.maximized,true);
    assert.deepEqual(app.calls,['fullscreen:true','fullscreen:false']);
  }
});

test('Failed native entry preserves maximization and leaves no rejected transition promises', async () => {
  const { app,service,errors }=windowFixture();
  app.setFullscreen=async value=>{app.calls.push(`fullscreen:${value}`);throw new Error('Denied');};
  const lease=service.acquire();await lease.ready;await lease.release();
  assert.equal(app.maximized,true);assert.equal(app.fullscreen,false);assert.equal(errors.length,1);
  assert.deepEqual(app.calls,['fullscreen:true']);
});

test('An external native exit closes the owning viewers, restores maximization and removes listeners', async () => {
  const { app,service }=windowFixture();let closed=0;
  const lease=service.acquire(()=>{closed++;lease.release();});await lease.ready;
  await app.resize();assert.equal(closed,0);
  await app.setFullscreen(false);await app.resize();await service.idle();
  assert.equal(closed,1);assert.equal(app.maximized,true);assert.equal(app.subscriptions,0);
  await lease.release();assert.equal(closed,1);
});

test('Fullscreen owned before opening a viewer remains active after the viewer closes', async () => {
  const { app,service }=windowFixture({fullscreen:true,maximized:false});
  const lease=service.acquire();await lease.ready;await lease.release();assert.equal(app.fullscreen,true);assert.deepEqual(app.calls,[]);
});

test('Subscription errors cannot trap the window in fullscreen or prevent restoration', async () => {
  const { app,service,errors }=windowFixture();
  app.onResized=async()=>{throw new Error('Subscription failed');};
  const lease=service.acquire();await lease.ready;assert.equal(app.fullscreen,true);
  await lease.release();assert.equal(app.fullscreen,false);assert.equal(app.maximized,true);assert.equal(errors.length,1);
});
