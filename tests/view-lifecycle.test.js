const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDeferredRefresh } = require('../src/windows/deferred-refresh');
const { loadSource } = require('./helpers/load-source');

test('held-pointer refresh requests share one timer and cancel on view disposal', () => {
  const pending = new Map(); let refreshed = 0;
  const deferred = createDeferredRefresh(() => refreshed++, 300, {
    setTimeout: callback => { const id = {}; pending.set(id, callback); return id; },
    clearTimeout: id => pending.delete(id),
  });
  deferred.schedule(); deferred.schedule(); deferred.schedule();
  assert.equal(pending.size, 1);
  deferred.cancel();
  assert.equal(pending.size, 0);
  assert.equal(refreshed, 0);
  deferred.schedule();
  [...pending.values()][0]();
  assert.equal(refreshed, 1);
});

test('graph interaction cleanup removes listeners and cancels auto-pan without opening a cancelled node', () => {
  class Target {
    constructor() { this.events = new Map(); this.classList = { add() {}, remove() {} }; }
    addEventListener(name, handler) { this.events.set(name, handler); }
    removeEventListener(name) { this.events.delete(name); }
    setAttribute() {}
  }
  const frames = new Map();
  const { bindGraphInteraction } = loadSource('graph-view/graph-interaction', {}, { window: {
    requestAnimationFrame: callback => { const id = {}; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  } });
  const svg = new Target(), scene = new Target(), node = { id: 'note.md', x: 10, y: 10, labelWidth: 60, g: new Target() };
  const zoomIn = new Target(), zoomOut = new Target(), reset = new Target();
  let opened = 0;
  const dispose = bindGraphInteraction({ svg, scene, nodes: [node], width: 1200, height: 760,
    zoomIn, zoomOut, reset, draw() {}, onOpen() { opened++; } });
  const down = { target: { closest: () => node.g }, clientX: 10, clientY: 10, pointerId: 1, preventDefault() {} };
  svg.events.get('pointerdown')(down);
  assert.equal(frames.size, 1);
  svg.events.get('pointercancel')({ pointerId: 1, type: 'pointercancel' });
  assert.equal(opened, 0);
  svg.events.get('pointerdown')(down);
  dispose(); dispose();
  assert.equal(frames.size, 0);
  for (const target of [svg, node.g, zoomIn, zoomOut, reset]) assert.equal(target.events.size, 0);
});
