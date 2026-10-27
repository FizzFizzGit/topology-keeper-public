const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag, options = {}) { this.tag = tag; this.children = []; this.options = options; this.dataset = {}; this.style = { setProperty() {} }; }
  createEl(tag, options) { const child = new Element(tag, options); child.parent = this; this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  setText() {} setAttr() {} addEventListener() {} closest() { return (this.options.cls || "").split(" ").includes("alp-detail-win") ? this : this.parent?.closest() ?? null; }
  empty() { this.children = []; }
  querySelector(selector) { return walk(this).find(child => selector.startsWith('.') ? (child.options.cls || '').split(' ').includes(selector.slice(1)) : child.tag === selector); }
  insertBefore(child, before) { this.children = this.children.filter(value => value !== child); const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); }
}
function walk(element) { return element.children.flatMap(child => [child, ...walk(child)]); }
function load(name, document = { body: new Element('body') }) {
  const context = { module: { exports: {} }, document,
    require: id => id === 'obsidian' ? { setIcon() {}, setTooltip() {} } : require('../src/graph-analysis') };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/' + name), 'utf8'), context);
  return context.module.exports;
}
test('section and area controls are outside summaries and remain visible when collapsed', () => {
  const Main = load('main-window');
  const main = new Main({ state: { sections: {} }, EVENT: {}, CSS_CLASS: {}, ICON: {}, UI_TEXT: {} });
  const parent = new Element('div');
  const section = main.section(parent, 'assets', 'リンクファイル');
  assert.equal(section.sectionActions.parent, section.parent);
  assert.equal(section.sectionActions.querySelector('button').tag, 'button');
  const Detail = load('detail-window');
  const detail = new Detail({ CSS_CLASS: {}, ICON: {}, EVENT: {} });
  detail.createAreaRow(section, { nodes: ['a', 'b', 'c'] }, 'planar', 0, 'blue');
  const area = section.querySelector('details');
  assert.equal(area.open, false);
  const button = area.parent.querySelector('button');
  assert.ok(button);
  assert.equal(walk(area).includes(button), false);
  const summaries = walk(parent).filter(child => child.tag === 'summary');
  assert.equal(summaries.length, 2);
  for (const summary of summaries) {
    assert.equal(walk(summary).some(child => ['button', 'input', 'a', 'select', 'textarea'].includes(child.tag) || child.options.attr?.role === 'button' || child.options.attr?.tabindex != null), false);
  }
});



test('rendering and closing the orphan window preserves the analysis information', () => {
  const document = { body: new Element('body') };
  const Main = load('main-window', document);
  const main = new Main({ state: { sections: { planar: true, orphan: true } }, EVENT: {}, CSS_CLASS: {}, ICON: {}, UI_TEXT: { clean: 'clean' } });
  const Detail = load('detail-window', document);
  const api = {
    CSS_CLASS: {}, EVENT: {}, ICON: {}, UI_TEXT: { clean: 'clean' },
    getPointerHeldAt: () => 0,
    getResult: () => ({ orphans: [], strayThumbs: [], orphanBases: [], planar: null }),
    disposeGraphListeners() {}, updateDetailButton() {}, iconButton() {}, enableDrag() {}, fitWindowToContent() {},
    section: main.section.bind(main),
    removeInfoPopovers(owner) {
      document.body.children = document.body.children.filter(child => child.dataset.owner !== owner);
    },
  };
  const area = new Detail(api, 'planar');
  const orphan = new Detail(api, 'orphan');
  for (const view of [area, orphan]) {
    view.visible = true;
    view.el = new Element('div', { cls: 'alp-detail-win' });
    view.el.dataset.infoOwner = view.infoOwner;
    view.el.addClass = () => {};
  }
  area.render();
  const original = document.body.children.find(child => child.dataset.owner === area.infoOwner);
  assert.ok(original);
  orphan.render();
  assert.ok(document.body.children.includes(original));
  assert.ok(document.body.children.some(child => child.dataset.owner === orphan.infoOwner));
  orphan.close();
  assert.ok(document.body.children.includes(original));
  assert.equal(document.body.children.some(child => child.dataset.owner === orphan.infoOwner), false);
  area.render();
  assert.equal(document.body.children.filter(child => child.dataset.owner === area.infoOwner).length, 1);
});
