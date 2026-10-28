const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadSettings } = require('../src/plugin-settings');

function detailFixture(state) {
  const context = {
    module: { exports: {} },
    require: id => id === 'obsidian' ? {} : id === './i18n' ? { t: require('../src/i18n-core').createTranslator('ja') } : require('../src/graph-analysis'),
    window: { innerWidth: 1200, innerHeight: 800 },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/detail-window'), 'utf8'), context);
  const View = context.module.exports;
  let hidden = true;
  const view = new View({
    CSS_CLASS: { isHidden: 'hidden' },
    updateDetailButton() {},
    getMainWindow: () => ({ getBoundingClientRect: () => ({ left: 900, top: 48 }) }),
    getDetailPosition: () => state.detailPos,
    setDetailPosition: position => { state.detailPos = position; },
    disposeGraphListeners() {}, removeInfoPopovers() {},
  });
  view.el = {
    style: {},
    classList: { remove() { hidden = false; }, contains() { return hidden; } },
    addClass() { hidden = true; },
    getBoundingClientRect() {
      return { left: parseFloat(this.style.left), top: parseFloat(this.style.top), width: 300, height: 400 };
    },
  };
  view.render = () => {};
  return view;
}
test('detail position survives close/reopen and settings reload', () => {
  const state = loadSettings({ detailPos: { x: 170, y: 210 } });
  const view = detailFixture(state);
  view.open();
  assert.equal(view.el.style.left, '170px');
  assert.equal(view.el.style.top, '210px');
  view.close();
  view.open();
  assert.equal(view.el.style.left, '170px');
  const reloaded = detailFixture(loadSettings(JSON.parse(JSON.stringify(state))));
  reloaded.open();
  assert.equal(reloaded.el.style.top, '210px');
});
test('positions outside a smaller screen are constrained on open', () => {
  const view = detailFixture(loadSettings({ detailPos: { x: 3000, y: 1800 } }));
  view.open();
  assert.equal(view.el.style.left, '900px');
  assert.equal(view.el.style.top, '400px');
});
test('detail reset restores default next to main window, including when closed', () => {
  const state = loadSettings({ detailPos: { x: 170, y: 210 } });
  const view = detailFixture(state);
  view.open();
  view.resetPosition();
  assert.equal(view.el.style.left, '595px');
  assert.equal(view.el.style.top, '48px');
  view.close();
  view.resetPosition();
  assert.equal(state.detailPos, null);
  view.open();
  assert.equal(view.el.style.left, '595px');
});
test('invalid coordinates fall back to default; old main-window positions remain supported', () => {
  assert.equal(loadSettings({ pos: { x: '20', y: 1 } }).pos, null);
  assert.equal(loadSettings({ detailPos: { x: null, y: 1 } }).detailPos, null);
  assert.deepEqual(loadSettings({ maintPos: { x: 20, y: 30 } }).pos, { x: 20, y: 30 });
});
