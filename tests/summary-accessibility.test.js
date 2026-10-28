const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag, options = {}) { this.tag = tag; this.children = []; this.options = options; this.dataset = {}; this.style = { setProperty() {} }; }
  createEl(tag, options) { const child = new Element(tag, options); child.parent = this; this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  setText() {} setAttr() {} addEventListener(name, handler) { (this.listeners ??= {})[name] = handler; } closest() { return (this.options.cls || "").split(" ").includes("alp-detail-win") ? this : this.parent?.closest() ?? null; }
  empty() { this.children = []; }
  querySelector(selector) { return walk(this).find(child => selector.startsWith('.') ? (child.options.cls || '').split(' ').includes(selector.slice(1)) : child.tag === selector); }
  insertBefore(child, before) { this.children = this.children.filter(value => value !== child); const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); }
}
function walk(element) { return element.children.flatMap(child => [child, ...walk(child)]); }
function load(name, document = { body: new Element('body') }, language = 'ja') {
  const context = { module: { exports: {} }, document,
    require: id => id === 'obsidian' ? { setIcon() {}, setTooltip() {} } : id === './i18n' ? { t: require('../src/i18n-core').createTranslator(language) } : require('../src/' + id.replace('./', '')) };
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
  main.EVENT = { click: 'click' };
  let closed = false;
  const close = main.iconButton(parent, 'x', 'Close', () => { closed = true; });
  assert.equal(close.tag, 'button');
  assert.equal(close.options.attr.type, 'button');
  assert.equal(close.options.attr['aria-label'], 'Close');
  close.listeners.click({ stopPropagation() {} });
  assert.equal(closed, true);
});

test('new area list separates counts, opens exact tag evidence and clears vanished selections', async () => {
  const { buildAreaModel } = require('../src/area-model');
  const graph = new Map();
  const edge = (a, b) => {
    for (const node of [a, b]) if (!graph.has(node)) graph.set(node, new Set());
    graph.get(a).add(b); graph.get(b).add(a);
  };
  for (const prefix of ['a', 'b']) {
    edge(prefix + '0', prefix + '1'); edge(prefix + '1', prefix + '2'); edge(prefix + '2', prefix + '0');
    edge('#cross', prefix + '0');
  }
  const model = await buildAreaModel(graph, async () => {});
  const roles = await require('../src/tag-role').assessTagRoles(graph, async () => {});
  for (const combined of model.combinedAreas) combined.tagRole = roles.get(combined.tag);
  let selected = null;
  const rendered = [];
  const Detail = load('detail-window');
  const detail = new Detail({ CSS_CLASS: {}, ICON: {}, EVENT: { click: 'click' },
    getAreaColors: () => ({ planar: 'blue' }), nodeChip() {},
    getSelectedCluster: () => selected, setSelectedCluster: value => { selected = value; },
    renderClusterGraph: (parent, selection) => rendered.push(selection),
  });
  detail.render = () => {};
  const parent = new Element('div');
  detail.renderAreaModel(parent, model);
  const texts = walk(parent).map(element => element.options.text).filter(Boolean);
  assert.ok(texts.includes('素領域　2エリア'));
  assert.ok(texts.includes('結合領域　1件'));
  assert.ok(texts.includes('判断材料が不足（重みは維持）'));
  const combined = walk(parent).find(element => element.options.cls === 'alp-finding is-combined');
  const button = combined.querySelector('button');
  button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(selected.exact, true);
  assert.equal(selected.tag, '#cross');
  assert.equal(selected.links.filter(([a, b]) => a === '#cross' || b === '#cross').length, 2);
  detail.renderAreaModel(new Element('div'), model);
  assert.equal(rendered.length, 1);
  detail.renderAreaModel(new Element('div'), { originalAreas: model.originalAreas, combinedAreas: [] });
  assert.equal(selected, null);
});

test('legacy density and planarity groups remain visible alongside the new area model', () => {
  const Main = load('main-window');
  const main = new Main({ state: { sections: {} }, EVENT: {}, CSS_CLASS: {}, ICON: {}, UI_TEXT: {} });
  const Detail = load('detail-window');
  const selection = { nodes: ['a', 'b', 'c'], links: [] };
  const rendered = [];
  const detail = new Detail({ CSS_CLASS: {}, ICON: {}, EVENT: {},
    section: main.section.bind(main), getAreaColors: () => ({}),
    getSelectedCluster: () => selection,
    setSelectedCluster() { throw new Error('legacy graph selection must remain available'); },
    nodeChip() {}, renderClusterGraph: (parent, selected) => rendered.push(selected),
  });
  const parent = new Element('div');
  const area = { nodes: ['a', 'b', 'c'], links: [], linkDensity: 1, density: 1, edges: 3 };
  detail.renderPlanar(parent, {
    areaModel: { originalAreas: [], combinedAreas: [] },
    planar: { safe: [area], definite: [{ ...area, edgeBoundExceeded: true }], suspect: [],
      hotspots: [{ ...area, meanLocalDensity: 1 }], boundaryEdges: [], meanDensityChange: 0 },
  });
  const texts = walk(parent).map(element => element.options.text).filter(Boolean);
  assert.ok(texts.includes('素領域　0エリア'));
  assert.ok(texts.includes('結合領域　0件'));
  assert.ok(texts.includes('密な関係・平面　1エリア'));
  assert.ok(texts.includes('密な関係・非平面　1エリア'));
  assert.ok(texts.includes('ホットスポット　1エリア'));
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0], selection);
});

test('hotspot row contains its original groups and tag connection instead of an unrelated top-level list', async () => {
  const { buildAreaHierarchy } = require('../src/area-model');
  const graph = new Map([
    ['a', new Set(['b', '#cross'])], ['b', new Set(['a'])],
    ['c', new Set(['d', '#cross'])], ['d', new Set(['c'])], ['#cross', new Set(['a', 'c'])],
  ]);
  const hotspot = { nodes: ['a', 'b', 'c', 'd', '#cross'], links: [], density: 0.5, meanLocalDensity: 0.5 };
  const planar = { safe: [], definite: [], suspect: [], hotspots: [hotspot], boundaryEdges: [], meanDensityChange: 0 };
  const areaModel = await buildAreaHierarchy(graph, planar, async () => {});
  const Main = load('main-window');
  const main = new Main({ state: { sections: {} }, EVENT: {}, CSS_CLASS: {}, ICON: {}, UI_TEXT: {} });
  const Detail = load('detail-window');
  const detail = new Detail({ CSS_CLASS: {}, ICON: {}, EVENT: {},
    section: main.section.bind(main), getAreaColors: () => ({}), nodeChip() {},
    getSelectedCluster: () => null,
  });
  const parent = new Element('div');
  detail.renderPlanar(parent, { planar, areaModel });
  const row = walk(parent).find(element => element.options.cls === 'alp-finding is-hotspot');
  const texts = walk(row).map(element => element.options.text).filter(Boolean);
  assert.ok(texts.includes('ホットスポット 1の内部'));
  assert.ok(texts.includes('素領域　2エリア'));
  assert.ok(texts.includes('結合領域　1件'));
  assert.ok(texts.some(text => text.includes('ホットスポット 1内の素領域')));
  const groupHeadings = walk(parent).filter(element => element.options.text === '素領域　2エリア');
  assert.equal(groupHeadings.length, 1);
  assert.ok(walk(row).includes(groupHeadings[0]));
});

test('only hotspot remainder is listed as undetermined, with cross-parent links inside the parent rows', async () => {
  const { buildAreaHierarchy } = require('../src/area-model');
  const graph = new Map([
    ['a', new Set(['b', '#cross'])], ['b', new Set(['a'])],
    ['c', new Set(['d', '#cross'])], ['d', new Set(['c'])], ['#cross', new Set(['a', 'c'])],
  ]);
  const finding = nodes => ({ nodes, originalNodes: nodes, links: [], density: 0.5, meanLocalDensity: 0.5 });
  const planar = { safe: [], definite: [], suspect: [finding(['a', 'b', 'c', 'd', '#cross'])],
    hotspots: [finding(['a', 'b'])], remainder: [finding(['c', 'd'])], boundaryEdges: [], meanDensityChange: 0 };
  const areaModel = await buildAreaHierarchy(graph, planar, async () => {});
  assert.equal(areaModel.parents.length, 2);
  assert.equal(areaModel.parents.some(parent => parent.kind === 'suspect'), false);
  const Main = load('main-window');
  const main = new Main({ state: { sections: {} }, EVENT: {}, CSS_CLASS: {}, ICON: {}, UI_TEXT: {} });
  const Detail = load('detail-window');
  const detail = new Detail({ CSS_CLASS: {}, ICON: {}, EVENT: {},
    section: main.section.bind(main), getAreaColors: () => ({}), nodeChip() {}, getSelectedCluster: () => null });
  detail.EVENT = { click: 'click' };
  const parent = new Element('div');
  detail.renderPlanar(parent, { planar, areaModel });
  const texts = walk(parent).map(element => element.options.text).filter(Boolean);
  assert.ok(texts.includes('小規模・平面性未判定　1エリア'));
  assert.ok(texts.indexOf('ホットスポット　1エリア') < texts.indexOf('小規模・平面性未判定　1エリア'));
  assert.equal(texts.includes('平面性未判定　1エリア'), false);
  assert.equal(texts.includes('異なる領域をまたぐタグ接続'), false);
  for (const kind of ['hotspot', 'undetermined']) {
    const row = walk(parent).find(element => element.options.cls === `alp-finding is-${kind}`);
    const nested = walk(row).map(element => element.options.text).filter(Boolean);
    assert.ok(nested.includes('結合領域　0件'));
    assert.ok(nested.includes('他エリアとの接続'));
    assert.ok(nested.includes('#cross'));
    assert.equal(nested.includes('領域間で共有する接続への参照です。'), false);
    assert.equal(walk(row).filter(element => element.options.cls === 'alp-finding is-combined').length, 0);
    assert.equal(nested.some(text => text.includes('undefined')), false);
  }
  const hotspotRow = walk(parent).find(element => element.options.cls === 'alp-finding is-hotspot');
  const remainderRow = walk(parent).find(element => element.options.cls === 'alp-finding is-undetermined');
  const firstReference = hotspotRow.querySelector('.alp-external-area-reference');
  const laterReference = remainderRow.querySelector('.alp-external-area-reference');
  assert.ok(firstReference.querySelector('.alp-partial-graph-button'));
  assert.equal(firstReference.querySelector('.alp-partial-graph-button').querySelector('.alp-tag-button-label').options.text, '#cross');
  assert.equal(laterReference.querySelector('.alp-partial-graph-button'), undefined);
  const jump = laterReference.querySelector('.alp-expand-connection-button');
  assert.equal(jump.querySelector('.alp-tag-button-label').options.text, '#cross');
  assert.ok(jump.options.attr['aria-label'].includes('ホットスポット 1'));
  let scrolled = false;
  firstReference.scrollIntoView = () => { scrolled = true; };
  const targetDetails = hotspotRow.querySelector('details');
  assert.equal(targetDetails.open, false);
  jump.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(targetDetails.open, true);
  assert.ok(detail.expandedAreas.has(targetDetails.areaExpansionKey));
  assert.equal(scrolled, true);
  const rerendered = new Element('div');
  detail.renderPlanar(rerendered, { planar, areaModel });
  const newHotspot = walk(rerendered).find(element => element.options.cls === 'alp-finding is-hotspot');
  assert.ok(newHotspot.querySelector('.alp-external-area-reference').querySelector('.alp-partial-graph-button'));
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

test('ordinary isolated notes are read-only and allowed notes and generated cleanup stay collapsed', () => {
  const Main = load('main-window');
  const main = new Main({ state: { sections: {} }, EVENT: {}, CSS_CLASS: {}, ICON: {}, UI_TEXT: {} });
  const Detail = load('detail-window');
  let opened = null;
  const note = { path: 'note.md', basename: 'note' };
  const detail = new Detail({ CSS_CLASS: {}, ICON: {}, EVENT: { click: 'click' }, UI_TEXT: { clean: 'clean' },
    section: main.section.bind(main), openFile: file => { opened = file; } });
  const parent = new Element('div');
  detail.renderOrphans(parent, { orphans: [], strayThumbs: [], orphanBases: [],
    noteIsolation: { ready: true, isolated: [note], tagOnly: [], allowed: [{ path: '未分類/ok.md' }] } }, 0);
  const texts = walk(parent).map(element => element.options.text).filter(Boolean);
  assert.ok(texts.includes('孤立ノート　1件'));
  assert.ok(texts.includes('孤立チェック対象外　1件'));
  assert.ok(texts.includes('管理データの整理'));
  assert.equal(walk(parent).filter(element => element.options.cls === 'alp-sec').length, 2);
  const managedTitle = walk(parent).find(element => element.options.text === '管理データの整理');
  assert.equal(managedTitle.parent.options.cls, 'alp-sec-summary');
  assert.equal(texts.some(text => text.includes('一括削除')), false);
  const button = parent.querySelector('.alp-note-isolation-link');
  button.listeners.click();
  assert.equal(opened, note);
  const allowed = walk(parent).find(element => element.tag === 'summary' && element.options.text === '孤立チェック対象外　1件');
  assert.notEqual(allowed.parent.open, true);
});

test('nested orphan sections invoke the same window fitting after expanding or collapsing', () => {
  const Main = load('main-window');
  const main = new Main({ state: { sections: {} }, EVENT: {}, CSS_CLASS: {}, ICON: {}, UI_TEXT: {} });
  const Detail = load('detail-window');
  let fits = 0, constraints = 0;
  const detail = new Detail({ CSS_CLASS: {}, ICON: {}, EVENT: {}, UI_TEXT: { clean: 'clean' },
    getPointerHeldAt: () => 0, section: main.section.bind(main),
    getResult: () => ({ orphans: [], strayThumbs: [], orphanBases: [],
      noteIsolation: { ready: true, isolated: [], tagOnly: [], allowed: [{ path: '未分類/ok.md' }] } }),
    iconButton() {}, enableDrag() {}, removeInfoPopovers() {}, fitWindowToContent() { fits++; },
  }, 'orphan');
  detail.visible = true;
  detail.el = new Element('div');
  detail.constrainToViewport = () => { constraints++; };
  detail.render();
  assert.equal(fits, 1);
  const body = detail.el.querySelector('.alp-detail-body');
  body.listeners.toggle();
  body.listeners.toggle();
  assert.equal(fits, 3);
  assert.equal(constraints, 2);
});

test('English main, isolated-note and analysis windows translate visible labels while preserving note names', async () => {
  const document = { body: new Element('body') };
  const Main = load('main-window', document, 'en');
  const empty = { orphans: [], strayThumbs: [], orphanBases: [],
    noteIsolation: { ready: true, isolated: [{ path: '日本語.md', basename: '日本語' }], tagOnly: [], allowed: [] } };
  const main = new Main({ state: { sections: {} }, EVENT: {}, CSS_CLASS: {}, ICON: {},
    UI_TEXT: { orphan: 'Isolated', crossingCandidates: 'Area candidates' },
    getPointerHeldAt: () => 0, getResult: () => empty, computeExternal: () => null,
    disposeGraphListeners() {}, removeInfoPopovers() {}, isDetailVisible: () => false,
    getActiveFile: () => null, isMainNote: () => false, renderExternal() {},
  });
  main.el = new Element('div'); main.el.toggleClass = () => {};
  main.iconButton = () => {}; main.enableDrag = () => {}; main.fitWindowToContent = () => {};
  main.render();
  const texts = walk(main.el).map(element => element.options.text).filter(Boolean);
  assert.ok(texts.includes('Area candidates'));
  assert.ok(texts.includes('File management'));
  const Detail = load('detail-window', document, 'en');
  const detail = new Detail({ CSS_CLASS: {}, ICON: {}, EVENT: {}, UI_TEXT: { clean: 'clean' },
    section: main.section.bind(main), getAreaColors: () => ({}), nodeChip() {}, getSelectedCluster: () => null });
  const isolated = new Element('div'); detail.renderOrphans(isolated, empty, 0);
  const isolatedTexts = walk(isolated).map(element => element.options.text).filter(Boolean);
  assert.ok(isolatedTexts.includes('Isolated notes: 1'));
  assert.ok(isolatedTexts.includes('Support data cleanup'));
  assert.ok(isolatedTexts.includes('日本語'));
  const finding = { nodes: ['a', 'b', 'c'], links: [], density: 0.5, meanLocalDensity: 0.5 };
  const planar = { safe: [], definite: [], suspect: [], hotspots: [finding], remainder: [], boundaryEdges: [], meanDensityChange: 0 };
  const areaModel = { originalAreas: [], combinedAreas: [], parents: [{
    id: JSON.stringify(['hotspots', [...finding.nodes].sort()]), kind: 'hotspots', category: 'hotspots', labelIndex: 1,
    label: 'ホットスポット 1', originalAreaIds: [], combinedAreaIds: [],
  }] };
  const analysis = new Element('div'); detail.renderPlanar(analysis, { ...empty, planar, areaModel });
  const analysisTexts = walk(analysis).map(element => element.options.text).filter(Boolean);
  assert.ok(analysisTexts.includes('Hotspots: 1 area'));
  assert.ok(analysisTexts.includes('Inside Hotspot 1'));
  assert.ok(analysisTexts.includes('Area 1 · 3 vertices'));
  assert.deepEqual(analysisTexts.filter(text => /[\u3040-\u30ff\u4e00-\u9fff]/.test(text)), []);
});
