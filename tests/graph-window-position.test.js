const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { loadSettings } = require('../src/plugin-settings');

function fixture(saved = {}) {
  const doc = new EventTarget();
  const win = Object.assign(new EventTarget(), { innerWidth: 1200, innerHeight: 800 });
  const context = { module: { exports: {} }, document: doc, window: win };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/graph-view'), 'utf8'), context);
  const head = new EventTarget();
  const panel = {
    style: { left: '48px', top: '32px' },
    getBoundingClientRect() {
      return { left: parseFloat(this.style.left), top: parseFloat(this.style.top), width: 680, height: 500 };
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
  return { doc, win, head, panel, plugin, cleanup, send, saves: () => saves };
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
