const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { loadSettings } = require('../src/plugin-settings');

function fixture(saved = {}) {
  const doc = new EventTarget();
  const win = Object.assign(new EventTarget(), { innerWidth: 1200, innerHeight: 800 });
  let resized;
  let disconnected = false;
  const context = { module: { exports: {} }, document: doc, window: win, setTimeout, clearTimeout,
    require: id => id === './i18n' ? { t: require('../src/i18n-core').createTranslator('ja') } : id === 'obsidian' ? { setIcon() {} } : require(id),
    ResizeObserver: class {
      constructor(callback) { resized = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/graph-view'), 'utf8'), context);
  const head = new EventTarget();
  const panel = {
    style: { left: '48px', top: '32px' },
    getBoundingClientRect() {
      return { left: parseFloat(this.style.left), top: parseFloat(this.style.top), width: parseFloat(this.style.width) || 680, height: parseFloat(this.style.height) || 500 };
    },
  };
  let saves = 0;
  const plugin = { state: loadSettings(saved), saveData() { saves++; } };
  const cleanup = context.module.exports.bindGraphWindowPosition(plugin, panel, head);
  function send(target, type, x = 0, y = 0) {
    const event = new Event(type);
    Object.assign(event, { button: 0, clientX: x, clientY: y });
    target.closest = () => null;
    target.dispatchEvent(event);
  }
  return { doc, win, head, panel, plugin, cleanup, send, resized: () => resized(), disconnected: () => disconnected, saves: () => saves };
}
test('graph drag position is saved once and restored on reopening', () => {
  const f = fixture();
  f.send(f.head, 'pointerdown', 60, 40);
  f.send(f.doc, 'pointermove', 210, 140);
  assert.equal(f.saves(), 0);
  f.send(f.doc, 'pointerup');
  assert.equal(f.saves(), 1);
  assert.equal(f.plugin.state.graphPos.x, 198);
  assert.equal(f.plugin.state.graphPos.y, 132);
  const next = fixture(JSON.parse(JSON.stringify(f.plugin.state)));
  assert.equal(next.panel.style.left, '198px');
  assert.equal(next.panel.style.top, '132px');
  f.cleanup();
  next.cleanup();
});
test('restored position and viewport resize keep the panel on screen', () => {
  const f = fixture({ graphPos: { x: 3000, y: 2000 } });
  assert.equal(f.panel.style.left, '520px');
  assert.equal(f.panel.style.top, '300px');
  f.win.innerWidth = 800;
  f.win.innerHeight = 600;
  f.send(f.win, 'resize');
  assert.equal(f.panel.style.left, '120px');
  assert.equal(f.panel.style.top, '100px');
  f.cleanup();
});
test('cleanup ends an active drag and removes listeners', () => {
  const f = fixture();
  f.send(f.head, 'pointerdown', 60, 40);
  f.send(f.doc, 'pointermove', 100, 100);
  f.cleanup();
  assert.equal(f.saves(), 1);
  const left = f.panel.style.left;
  f.send(f.doc, 'pointermove', 400, 400);
  f.send(f.doc, 'pointerup');
  assert.equal(f.panel.style.left, left);
  assert.equal(f.saves(), 1);
});

test('graph resize persists size and position and restores both after settings reload', () => {
  const f = fixture({ graphPos: { x: 400, y: 250 } });
  f.panel.style.width = '900px';
  f.panel.style.height = '650px';
  f.resized();
  assert.equal(f.saves(), 0);
  f.send(f.doc, 'pointerup');
  assert.equal(f.saves(), 1);
  assert.equal(f.plugin.state.graphSize.width, 900);
  assert.equal(f.plugin.state.graphSize.height, 650);
  assert.equal(f.plugin.state.graphPos.x, 300);
  assert.equal(f.plugin.state.graphPos.y, 150);
  const next = fixture(JSON.parse(JSON.stringify(f.plugin.state)));
  assert.equal(next.panel.style.width, '900px');
  assert.equal(next.panel.style.height, '650px');
  assert.equal(next.panel.style.left, '300px');
  assert.equal(next.panel.style.top, '150px');
  f.cleanup(); next.cleanup();
  assert.equal(f.saves(), 1);
  assert.equal(f.disconnected(), true);
});

test('closing immediately after resize saves pending geometry and disconnects the observer', () => {
  const f = fixture();
  f.panel.style.width = '780px';
  f.panel.style.height = '550px';
  f.cleanup();
  assert.equal(f.plugin.state.graphSize.width, 780);
  assert.equal(f.plugin.state.graphSize.height, 550);
  assert.equal(f.saves(), 1);
  assert.equal(f.disconnected(), true);
  f.send(f.doc, 'pointerup');
  assert.equal(f.saves(), 1);
});

test('saved graph sizes are validated and constrained to the available viewport', () => {
  for (const size of [{ width: -1, height: 50 }, { width: Infinity, height: 50 }, { width: '700', height: 50 }])
    assert.equal(loadSettings({ graphSize: size }).graphSize, null);
  const f = fixture({ graphSize: { width: 4000, height: 3000 }, graphPos: { x: 4000, y: 3000 } });
  const rect = f.panel.getBoundingClientRect();
  assert.ok(rect.width <= f.win.innerWidth);
  assert.ok(rect.height <= f.win.innerHeight);
  assert.ok(rect.left + rect.width <= f.win.innerWidth);
  assert.ok(rect.top + rect.height <= f.win.innerHeight);
  f.cleanup();
});
