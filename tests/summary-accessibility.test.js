const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag, options = {}) { this.tag = tag; this.children = []; this.options = options; this.dataset = {};
    this.style = { setProperty: (name, value) => { this.style[name] = value; }, removeProperty() {} }; }
  createEl(tag, options) { const child = new Element(tag, options); child.parent = this; this.children.push(child); return child; }
  get ownerDocument() { return { createElement: tag => new Element(tag) }; }
  set className(value) { this.options.cls = value; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  set textContent(value) { this.options.text = value; }
  setAttribute() {} removeAttribute() {} removeEventListener() {}
  setText() {} setAttr() {} addEventListener(name, handler) { (this.listeners ??= {})[name] = handler; } closest() { return (this.options.cls || "").split(" ").includes("alp-detail-win") ? this : this.parent?.closest() ?? null; }
  empty() { this.children = []; }
  querySelector(selector) { return walk(this).find(child => selector.startsWith('.') ? (child.options.cls || '').split(' ').includes(selector.slice(1)) : child.tag === selector); }
  querySelectorAll(selector) {
    if (selector === 'details[open]') return walk(this).filter(child => child.tag === 'details' && child.open);
    return walk(this).filter(child => (child.options.cls || '').split(' ').includes(selector.slice(1)));
  }
  insertBefore(child, before) { this.children = this.children.filter(value => value !== child); const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); }
}
function walk(element) { return element.children.flatMap(child => [child, ...walk(child)]); }
function load(name, document = { body: new Element('body') }, language = 'ja') {
  const context = { module: { exports: {} }, document,
    require: id => {
      if (id === 'obsidian') return { setIcon() {}, setTooltip() {} };
      if (id === './i18n') return { t: require('../src/i18n-core').createTranslator(language) };
      if (id === './hover-menu') return { closeActiveHoverMenu() {} };
      return require('../src/' + id.replace('./', ''));
    } };
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
  detail.analysisContent.createAreaRow(section, { nodes: ['a', 'b', 'c'] }, 'planar', 0, 'blue');
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

test('current hierarchy opens exact tag evidence and clears vanished selections', async () => {
  const { buildAreaHierarchy } = require('../src/area-model');
  const graph = new Map();
  const edge = (a, b) => {
    for (const node of [a, b]) if (!graph.has(node)) graph.set(node, new Set());
    graph.get(a).add(b); graph.get(b).add(a);
  };
  for (const prefix of ['a', 'b']) {
    edge(prefix + '0', prefix + '1'); edge(prefix + '1', prefix + '2'); edge(prefix + '2', prefix + '0');
    edge('#cross', prefix + '0');
  }
  const planar = { safe: [], definite: [], suspect: [], remainder: [{ nodes: [...graph.keys()], links: [], density: 0.5, meanLocalDensity: 0.5 }] };
  const model = await buildAreaHierarchy(graph, planar, async () => {});
  const Main = load('main-window');
  const main = new Main({ state: { sections: {} }, EVENT: {}, CSS_CLASS: {}, ICON: {}, UI_TEXT: {} });
  const roles = await require('../src/tag-role').assessTagRoles(graph, async () => {});
  for (const combined of model.combinedAreas) combined.tagRole = roles.get(combined.tag);
  let selected = null;
  const rendered = [];
  const Detail = load('detail-window');
  const detail = new Detail({ CSS_CLASS: {}, ICON: {}, EVENT: { click: 'click' },
    section: main.section.bind(main), getAreaColors: () => ({ planar: 'blue' }), nodeChip() {},
    getSelectedCluster: () => selected, setSelectedCluster: value => { selected = value; },
    renderClusterGraph: (parent, selection) => rendered.push(selection),
  });
  detail.render = () => {};
  const parent = new Element('div');
  detail.renderPlanar(parent, { planar, areaModel: model });
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
  detail.renderPlanar(new Element('div'), { planar, areaModel: model });
  assert.equal(rendered.length, 1);
  detail.renderPlanar(new Element('div'), { planar, areaModel: { ...model, combinedAreas: [] } });
  assert.equal(selected, null);
});

test('the distance experiment opens its area and combined graph in its own analysis section', async () => {
  const { analyzeDistanceAreas } = require('../src/distance-area-analysis');
  const graph = new Map([
    ['diary', new Set(['exercise', '#jobs'])],
    ['exercise', new Set(['diary'])],
    ['job', new Set(['#jobs'])],
    ['trivia', new Set(['#jobs'])],
    ['#jobs', new Set(['diary', 'job', 'trivia'])],
  ]);
  const distanceAnalysis = await analyzeDistanceAreas(graph, async () => {});
  const Main = load('main-window');
  const main = new Main({ state: { sections: { distanceAreas: true } }, EVENT: {}, CSS_CLASS: {}, ICON: {}, UI_TEXT: {} });
  const Detail = load('detail-window');
  let selected, rendered;
  const detail = new Detail({ CSS_CLASS: {}, ICON: {}, EVENT: { click: 'click' },
    section: main.section.bind(main), getAreaColors: () => ({ densePlanar: '#dd9944', planar: '#8e72cc', nonplanar: '#ad4861', undetermined: '#667788' }), nodeChip() {},
    getSelectedCluster: () => selected, setSelectedCluster: value => { selected = value; },
    renderClusterGraph: (section, selection) => { rendered = { section, selection }; },
  });
  detail.render = () => {};
  const result = { distanceAnalysis, planar: { safe: [], definite: [], suspect: [] } };
  const body = new Element('div');
  detail.renderPlanar(body, result);
  const section = walk(body).find(element => element.dataset.sectionKey === 'distanceAreas');
  assert.equal(section.open, true);
  assert.ok(!walk(section).some(element => element.tag === 'button' && element.options.text === '距離エリアを再計算'));
  assert.ok(!walk(body).some(element => element.dataset.sectionKey === 'planar'));
  const area = walk(section).find(element => element.options.cls === 'alp-finding is-distance');
  assert.equal(area.querySelector('summary').querySelector('span').options.text, '#jobs');
  assert.equal(area.style['--alp-area-color'], '#667788');
  const primitive = walk(area).find(element => element.options.cls === 'alp-finding is-primitive');
  assert.equal(primitive.querySelector('summary').querySelector('span').options.text, 'diary');
  assert.ok(walk(section).some(element => element.options.text === '素領域 1・単独ノート 2 を接続 · 計 4ノート'));
  assert.ok(walk(section).some(element => element.options.text === '疎な関係・平面 · 平均接続数 1.60本'));
  const row = walk(section).find(element => element.options.cls === 'alp-finding is-combined');
  assert.equal(row.querySelector('summary').querySelector('span').options.text, '#jobs');
  assert.equal(row.style['--alp-area-color'], '#8e72cc');
  row.querySelector('button').listeners.click({ preventDefault() {}, stopPropagation() {} });
  detail.renderPlanar(new Element('div'), result);
  assert.equal(rendered.section.parent.dataset.sectionKey, 'distanceAreas');
  assert.equal(rendered.selection.tag, '#jobs');
  assert.equal(rendered.selection.title, '#jobs');
  assert.equal(rendered.selection.nodes.length, 5);
});

test('current hierarchy retains density and planarity classifications without an old-format heading', async () => {
  const { buildAreaHierarchy } = require('../src/area-model');
  const graph = new Map([['a', new Set(['b', 'c'])], ['b', new Set(['a', 'c'])], ['c', new Set(['a', 'b'])]]);
  const finding = { nodes: ['a', 'b', 'c'], links: [['a', 'b'], ['a', 'c'], ['b', 'c']], linkDensity: 1, density: 1, edges: 3 };
  const planar = { safe: [finding], definite: [{ ...finding, edgeBoundExceeded: true }], suspect: [],
    remainder: [finding] };
  const model = await buildAreaHierarchy(graph, planar, async () => {});
  const Main = load('main-window');
  const main = new Main({ state: { sections: {} }, EVENT: {}, CSS_CLASS: {}, ICON: {}, UI_TEXT: {} });
  const Detail = load('detail-window');
  const detail = new Detail({ CSS_CLASS: {}, ICON: {}, EVENT: {}, section: main.section.bind(main),
    getAreaColors: () => ({}), nodeChip() {}, getSelectedCluster: () => null });
  const parent = new Element('div');
  detail.renderPlanar(parent, { planar, areaModel: model });
  const texts = walk(parent).map(element => element.options.text).filter(Boolean);
  for (const heading of ['密な関係・平面　1エリア', '密な関係・非平面　1エリア', '境界部分・平面性未判定　1エリア'])
    assert.ok(texts.includes(heading));
  assert.equal(texts.some(text => text.includes('従来の領域分け')), false);
});

test('undetermined row contains its original groups and tag connection instead of an unrelated top-level list', async () => {
  const { buildAreaHierarchy } = require('../src/area-model');
  const graph = new Map([
    ['a', new Set(['b', '#cross'])], ['b', new Set(['a'])],
    ['c', new Set(['d', '#cross'])], ['d', new Set(['c'])], ['#cross', new Set(['a', 'c'])],
  ]);
  const undetermined = { nodes: ['a', 'b', 'c', 'd', '#cross'], links: [], density: 0.5, meanLocalDensity: 0.5 };
  const planar = { safe: [], definite: [], suspect: [], remainder: [undetermined] };
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
  const row = walk(parent).find(element => element.options.cls === 'alp-finding is-undetermined');
  const texts = walk(row).map(element => element.options.text).filter(Boolean);
  assert.ok(texts.includes('素領域　2エリア'));
  assert.ok(texts.includes('結合領域　1件'));
  assert.equal(texts.filter(text => text === 'タグ該当 1ノート').length, 2);
  const groupHeadings = walk(parent).filter(element => element.options.text === '素領域　2エリア');
  assert.equal(groupHeadings.length, 1);
  assert.ok(walk(row).includes(groupHeadings[0]));
});

test('cross-parent links appear inside the planar and undetermined rows', async () => {
  const { buildAreaHierarchy } = require('../src/area-model');
  const graph = new Map([
    ['a', new Set(['b', '#cross'])], ['b', new Set(['a'])],
    ['c', new Set(['d', '#cross'])], ['d', new Set(['c'])], ['#cross', new Set(['a', 'c'])],
  ]);
  const finding = nodes => ({ nodes, originalNodes: nodes, links: [], density: 0.5, meanLocalDensity: 0.5 });
  const planar = { safe: [finding(['a', 'b'])], definite: [], suspect: [finding(['c', 'd'])],
    remainder: [finding(['c', 'd'])] };
  const areaModel = await buildAreaHierarchy(graph, planar, async () => {});
  assert.equal(areaModel.parents.length, 2);
  assert.equal(areaModel.parents.some(parent => parent.kind === 'suspect'), false);
  const Main = load('main-window');
  const main = new Main({ state: { sections: {} }, EVENT: {}, CSS_CLASS: {}, ICON: {}, UI_TEXT: {} });
  const Detail = load('detail-window');
  const detail = new Detail({ CSS_CLASS: {}, ICON: {}, EVENT: {},
    section: main.section.bind(main), getAreaColors: () => ({}), nodeChip() {}, getSelectedCluster: () => null });
  detail.api.EVENT.click = 'click';
  const parent = new Element('div');
  detail.renderPlanar(parent, { planar, areaModel });
  const texts = walk(parent).map(element => element.options.text).filter(Boolean);
  assert.ok(texts.includes('小規模・平面性未判定　1エリア'));
  assert.ok(texts.indexOf('疎な関係・平面　1エリア') < texts.indexOf('小規模・平面性未判定　1エリア'));
  assert.equal(texts.includes('平面性未判定　1エリア'), false);
  assert.equal(texts.includes('異なる領域をまたぐタグ接続'), false);
  for (const kind of ['planar', 'undetermined']) {
    const row = walk(parent).find(element => element.options.cls === `alp-finding is-${kind}`);
    const nested = walk(row).map(element => element.options.text).filter(Boolean);
    assert.ok(!nested.includes('結合領域　0件'));
    assert.ok(nested.includes('他エリアとの接続'));
    assert.ok(nested.includes('#cross'));
    assert.equal(nested.includes('領域間で共有する接続への参照です。'), false);
    assert.equal(walk(row).filter(element => element.options.cls === 'alp-finding is-combined').length, 0);
    assert.equal(nested.some(text => text.includes('undefined')), false);
  }
  const planarRow = walk(parent).find(element => element.options.cls === 'alp-finding is-planar');
  const remainderRow = walk(parent).find(element => element.options.cls === 'alp-finding is-undetermined');
  const firstReference = planarRow.querySelector('.alp-external-area-reference');
  const laterReference = remainderRow.querySelector('.alp-external-area-reference');
  assert.ok(firstReference.querySelector('.alp-partial-graph-button'));
  assert.equal(firstReference.querySelector('.alp-partial-graph-button').querySelector('.alp-tag-button-label').options.text, '#cross');
  assert.equal(laterReference.querySelector('.alp-partial-graph-button'), undefined);
  const jump = laterReference.querySelector('.alp-expand-connection-button');
  assert.equal(jump.querySelector('.alp-tag-button-label').options.text, '#cross');
  assert.ok(jump.options.attr['aria-label'].includes('平面領域 1'));
  let scrolled = false;
  firstReference.scrollIntoView = () => { scrolled = true; };
  const targetDetails = planarRow.querySelector('details');
  assert.equal(targetDetails.open, false);
  jump.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(targetDetails.open, true);
  assert.ok(detail.analysisContent.expandedAreas.has(targetDetails.areaExpansionKey));
  assert.equal(scrolled, true);
  const rerendered = new Element('div');
  detail.renderPlanar(rerendered, { planar, areaModel });
  const newPlanar = walk(rerendered).find(element => element.options.cls === 'alp-finding is-planar');
  assert.ok(newPlanar.querySelector('.alp-external-area-reference').querySelector('.alp-partial-graph-button'));
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
  assert.ok(texts.includes('管理データの整理　0件'));
  assert.equal(walk(parent).filter(element => element.options.cls === 'alp-sec').length, 2);
  const managedTitle = walk(parent).find(element => element.options.text === '管理データの整理　0件');
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
  const sections = { orphan: true, assets: true };
  let saves = 0;
  const main = new Main({ state: { sections }, EVENT: {}, CSS_CLASS: {}, ICON: {}, UI_TEXT: {},
    saveState() { saves++; } });
  const Detail = load('detail-window');
  let fits = 0, constraints = 0, collapse;
  const detail = new Detail({ CSS_CLASS: {}, ICON: {}, EVENT: {}, UI_TEXT: { clean: 'clean' },
    getPointerHeldAt: () => 0, section: main.section.bind(main),
    getResult: () => ({ orphans: [], strayThumbs: [], orphanBases: [],
      noteIsolation: { ready: true, isolated: [], tagOnly: [], allowed: [{ path: '未分類/ok.md' }] } }),
    collapseSections: main.collapseSections.bind(main),
    iconButton(_parent, icon, _label, action) { if (icon === 'fold-vertical') collapse = action; },
    enableDrag() {}, removeInfoPopovers() {}, fitWindowToContent() { fits++; },
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
  const nested = body.querySelector('.alp-orphan-fold');
  nested.open = true;
  const openSections = body.querySelectorAll('details[open]');
  assert.equal(openSections.length, 2);
  collapse();
  assert.equal(body.querySelectorAll('details[open]').length, 0);
  assert.deepEqual(sections, { orphan: false, assets: true });
  assert.equal(saves, 1);
  for (const target of openSections) body.listeners.toggle({ target });
  assert.equal(fits, 4);
  assert.equal(constraints, 3);
});

test('English main, isolated-note and analysis windows translate visible labels while preserving note names', async () => {
  const document = { body: new Element('body') };
  const Main = load('main-window', document, 'en');
  const empty = { orphans: [], strayThumbs: [], orphanBases: [],
    noteIsolation: { ready: true, isolated: [{ path: '日本語.md', basename: '日本語' }], tagOnly: [], allowed: [] } };
  const main = new Main({ state: { sections: {} }, EVENT: {}, CSS_CLASS: {}, ICON: {},
    UI_TEXT: { orphan: 'Isolated', crossingCandidates: 'Areas' },
    getPointerHeldAt: () => 0, getResult: () => empty, computeExternal: () => null,
    disposeGraphListeners() { throw new Error('main render must preserve the analysis graph'); }, removeInfoPopovers() {}, isDetailVisible: () => false,
    getActiveFile: () => null, isMainNote: () => false, renderExternal() {},
  });
  main.el = new Element('div'); main.el.toggleClass = () => {};
  main.iconButton = () => {}; main.enableDrag = () => {}; main.fitWindowToContent = () => {};
  main.render();
  const texts = walk(main.el).map(element => element.options.text).filter(Boolean);
  assert.ok(texts.includes('Areas'));
  assert.ok(texts.includes('File management'));
  const Detail = load('detail-window', document, 'en');
  const detail = new Detail({ CSS_CLASS: {}, ICON: {}, EVENT: {}, UI_TEXT: { clean: 'clean' },
    section: main.section.bind(main), getAreaColors: () => ({}), nodeChip() {}, getSelectedCluster: () => null });
  const isolated = new Element('div'); detail.renderOrphans(isolated, empty, 0);
  const isolatedTexts = walk(isolated).map(element => element.options.text).filter(Boolean);
  assert.ok(isolatedTexts.includes('Isolated notes: 1'));
  assert.ok(isolatedTexts.includes('Support data cleanup: 0'));
  assert.ok(isolatedTexts.includes('日本語'));
  const finding = { nodes: ['a', 'b', 'c'], links: [], density: 0.5, meanLocalDensity: 0.5 };
  const planar = { safe: [], definite: [], suspect: [], remainder: [finding] };
  const areaModel = { originalAreas: [], combinedAreas: [], parents: [{
    id: JSON.stringify(['remainder', [...finding.nodes].sort()]), kind: 'remainder', category: 'low', labelIndex: 1,
    originalAreaIds: [], combinedAreaIds: [],
  }] };
  const analysis = new Element('div'); detail.renderPlanar(analysis, { ...empty, planar, areaModel });
  const analysisTexts = walk(analysis).map(element => element.options.text).filter(Boolean);
  assert.ok(analysisTexts.includes('Low density · planarity undetermined: 1 area'));
  assert.ok(analysisTexts.includes('Area 1 · 3 vertices'));
  assert.deepEqual(analysisTexts.filter(text => /[\u3040-\u30ff\u4e00-\u9fff]/.test(text)), []);
});

test('isolated indicator totals ordinary notes and every generated-data kind and remains unknown while parsing', () => {
  const Main = load('main-window');
  const file = path => ({ path });
  let result = { orphans: [file('_meta/a.md')], strayThumbs: [file('_thumbs/web-a.png')], orphanBases: [file('_bases/a.base')],
    noteIsolation: { ready: true, isolated: [file('a.md'), file('b.md')], tagOnly: [file('tag.md')], allowed: [file('allowed.md')] } };
  const main = new Main({ state: { sections: {} }, EVENT: {}, CSS_CLASS: {}, ICON: {},
    UI_TEXT: { orphan: '孤立', crossingCandidates: 'エリア' },
    getPointerHeldAt: () => 0, getResult: () => result, computeExternal: () => null,
    disposeGraphListeners() {}, removeInfoPopovers() {}, isDetailVisible: () => false,
    getActiveFile: () => null, isMainNote: () => false, renderExternal() {},
  });
  main.el = new Element('div'); main.el.toggleClass = () => {};
  main.iconButton = () => {}; main.enableDrag = () => {}; main.fitWindowToContent = () => {};
  const value = () => {
    main.render(true);
    return main.indicatorButtons.orphan.querySelector('.alp-indicator-value').options.text;
  };
  assert.equal(value(), '5');
  result.noteIsolation.isolated = [];
  assert.equal(value(), '3');
  result.maintenanceReady = false;
  assert.equal(value(), '…');
  result.maintenanceReady = true;
  result.noteIsolation.ready = false;
  assert.equal(value(), '…');
  delete result.noteIsolation;
  assert.equal(value(), '3');
});

test('main window offers an accessible web-thumbnail button for ordinary notes', () => {
  const Main = load('main-window');
  let opened = 0;
  const file = { path: 'note.md' };
  const main = new Main({ state: { sections: {} }, EVENT: { click: 'click' }, CSS_CLASS: {}, ICON: {}, UI_TEXT: {},
    getPointerHeldAt: () => 0, getResult: () => null, computeExternal: () => null,
    disposeGraphListeners() {}, removeInfoPopovers() {}, isDetailVisible: () => false,
    getActiveFile: () => file, isMainNote: () => true, renderExternal() {}, createWebThumbnail() { opened++; },
  });
  main.el = new Element('div'); main.el.toggleClass = () => {};
  main.iconButton = () => {}; main.enableDrag = () => {}; main.fitWindowToContent = () => {};
  main.render();
  const button = walk(main.el).find(element => element.options.attr?.['aria-label'] === 'URLからWebサムネイルを挿入');
  assert.ok(button);
  assert.equal(button.disabled, false);
  button.listeners.click();
  assert.equal(opened, 1);
  main.api.isMainNote = () => false;
  main.render(true);
  const disabled = walk(main.el).find(element => element.options.attr?.title === 'URLからWebサムネイルを挿入');
  assert.equal(disabled.disabled, true);
});
