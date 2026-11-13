const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./helpers/load-source');
const { loadSettings } = require('../src/settings/plugin-settings');

function element() {
  const classes = new Set();
  return {
    classList: { add: name => classes.add(name), contains: name => classes.has(name),
      remove: (...names) => names.forEach(name => classes.delete(name)) },
    appendChild(child) { child.parentElement = this; },
  };
}

function fixture() {
  const views = new Map(), leaves = new Set();
  let beforeOpen;
  const createLeaf = side => {
    const leaf = {
      side,
      async setViewState(state) {
        this.state = state;
        this.view = views.get(state.type)(this);
        await this.view.onOpen();
        await beforeOpen?.(this);
      },
      getViewState() { return this.state; },
      detach() { leaves.delete(this); void this.view?.onClose(); },
    };
    leaves.add(leaf);
    return leaf;
  };
  const workspace = {
    getLeftLeaf: () => createLeaf('left'), getRightLeaf: () => createLeaf('right'),
    revealLeaf: async () => {},
    getLeavesOfType: type => [...leaves].filter(leaf => leaf.state?.type === type),
    detachLeavesOfType(type) { this.getLeavesOfType(type).forEach(leaf => leaf.detach()); },
  };
  const plugin = { manifest: { id: 'topology-keeper' }, app: { workspace },
    state: loadSettings({ windowPlacement: { planar: 'left' } }),
    registerView: (type, create) => views.set(type, create) };
  const { SidebarWindows } = loadSource('windows/sidebar-windows', { obsidian: {
    ItemView: class { constructor() { this.contentEl = element(); } },
    Notice: class { constructor(message) { throw new Error(message); } },
  } });
  return { plugin, leaves, panels: new SidebarWindows(plugin), pauseOpening: callback => { beforeOpen = callback; } };
}

test('switching sides moves the same window and native close returns it to its original host', async () => {
  const { plugin, leaves, panels } = fixture();
  const original = element(), window = element();
  original.appendChild(window);
  let closed = 0;
  const close = () => { closed++; };
  await panels.show('planar', window, close);
  const [left] = leaves;
  assert.equal(left.side, 'left');
  assert.equal(window.parentElement, left.view.contentEl);
  plugin.state.windowPlacement.planar = 'right';
  await panels.show('planar', window, close);
  const [right] = leaves;
  assert.equal(leaves.size, 1);
  assert.equal(right.side, 'right');
  assert.equal(window.parentElement, right.view.contentEl);
  assert.equal(closed, 0);
  right.detach();
  assert.equal(window.parentElement, original);
  assert.equal(window.classList.contains('tk-docked-window'), false);
  assert.equal(closed, 1);
});

test('closing while a sidebar view loads cannot mount a stale window', async () => {
  const { leaves, panels, pauseOpening } = fixture();
  let finish, loading;
  const started = new Promise(resolve => { loading = resolve; });
  pauseOpening(() => new Promise(resolve => { finish = resolve; loading(); }));
  const original = element(), window = element();
  original.appendChild(window);
  const pending = panels.show('planar', window, () => assert.fail('programmatic close'));
  await started;
  panels.hide('planar');
  finish();
  await pending;
  assert.equal(leaves.size, 0);
  assert.equal(window.parentElement, original);
  assert.equal(window.classList.contains('tk-dock-pending'), false);
});
