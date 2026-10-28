const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createTranslator } = require('../src/i18n-core');
const { toSourceUrl } = require('../src/source-url');

class Element {
  constructor(tag, options = {}) {
    this.tag = tag; this.options = options; this.textContent = options.text ?? '';
    this.value = ''; this.checked = false;
    this.children = []; this.style = {}; this.attributes = { ...options.attr };
    this.listeners = {}; this.classList = { add() {}, remove() {} };
  }
  createEl(tag, options) { const child = new Element(tag, options); this.appendChild(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  appendChild(child) { child.parent = this; this.children.push(child); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  setAttr(key, value) { this.setAttribute(key, value); }
  setText(text) { this.textContent = text; }
  addEventListener(key, callback) { this.listeners[key] = callback; }
  removeEventListener(key) { delete this.listeners[key]; }
  addClass() {} focus() {} setSelectionRange() {}
  empty() { this.children = []; }
  getBoundingClientRect() { return { left: parseFloat(this.style.left) || 48, top: parseFloat(this.style.top) || 32, width: 680, height: 500 }; }
}
const walk = element => [element, ...element.children.flatMap(walk)];
const text = element => walk(element).map(node => node.textContent).filter(Boolean).join('\n');
function fixture(language = 'en') {
  const controls = [], notices = [];
  class Modal { constructor() { this.contentEl = new Element('div'); } setTitle(title) { this.title = title; } close() { this.closed = true; } }
  class Setting {
    setName(name) { this.name = name; return this; } setDesc() { return this; }
    control(callback) {
      const control = { inputEl: new Element('input'), setValue(value) { this.value = value; return this; },
        setButtonText(value) { this.text = value; return this; }, setCta() { return this; }, setDisabled() { return this; },
        onChange(callback) { this.change = callback; return this; }, onClick(callback) { this.click = callback; return this; } };
      controls.push(control); callback(control); return this;
    }
    addText(callback) { return this.control(callback); } addButton(callback) { return this.control(callback); }
  }
  const modules = new Map();
  const document = new Element('document'); document.createElementNS = (ns, tag) => new Element(tag);
  const window = Object.assign(new Element('window'), { innerWidth: 1200, innerHeight: 800 });
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, console, document, window, setTimeout, clearTimeout, Map, Set, URL, process,
      require: id => id === './i18n' ? { t: createTranslator(language) }
        : id === 'obsidian' ? { Modal, Setting, Notice: class { constructor(message) { notices.push(message); } }, setIcon() {}, setTooltip() {} }
          : id.startsWith('.') ? load(require.resolve(path.resolve(path.dirname(filename), id))) : require(id),
    }, { filename });
    return module.exports;
  }
  return { controls, notices, load: name => load(require.resolve('../src/' + name)) };
}

test('English partial graph controls and legend preserve original note labels', () => {
  const f = fixture();
  const { renderClusterGraph } = f.load('graph-view');
  const parent = new Element('div');
  const plugin = { state: {}, maint: { graphAdj: new Map([
    ['日本語.md', new Set(['other.md'])], ['other.md', new Set(['日本語.md'])],
  ]) }, disposeGraphListeners() {}, saveData() {} };
  renderClusterGraph(plugin, parent, { nodes: ['日本語.md', 'other.md'], links: [], title: 'Area 1' });
  const contents = text(parent);
  assert.ok(contents.includes('Fit'));
  assert.ok(contents.includes('ⓘ Controls'));
  assert.ok(contents.includes('Selected area'));
  assert.ok(contents.includes('日本語'));
  assert.equal(contents.includes('操作方法'), false);
  plugin.maint.graphCleanup();
});

test('English rename dialog submits the unchanged user filename', async () => {
  const f = fixture();
  const Rename = f.load('rename-external-modal');
  let renamed;
  const modal = new Rename({}, '日本語.txt', async name => { renamed = name; });
  modal.onOpen();
  assert.equal(modal.title, 'Rename external file');
  assert.ok(f.controls.some(control => control.text === 'Cancel'));
  await f.controls.find(control => control.text === 'Change').click();
  assert.equal(renamed, '日本語.txt');
  assert.equal(modal.closed, true);
});

test('English file move confirmation, completion and recovery notices use translated messages', async () => {
  const f = fixture();
  const Move = f.load('move-external-modal');
  const source = toSourceUrl(path.resolve('日本語.txt'));
  const modal = new Move({}, [{ source }], { moveExternalFiles: async entries => entries });
  modal.folder = path.resolve('移動先'); modal.selected.add(source);
  modal.renderConfirmation();
  assert.equal(modal.title, 'Review file move');
  assert.ok(text(modal.contentEl).includes('Move 1 file'));
  assert.ok(text(modal.contentEl).includes('日本語.txt'));
  await f.controls.find(control => control.text === 'Move files').click();
  assert.ok(text(modal.contentEl).includes('Moved 1 file.'));
  const Import = f.load('import-workflow');
  const workflow = new Import({ state: {} }, {});
  await workflow.recover();
  assert.ok(f.notices.includes('No unfinished imports.'));
});

test('English tag suggestion modal preserves selected tags and manual user input', () => {
  const f = fixture();
  const { TagSuggestModal } = f.load('tag-suggest');
  let submitted;
  const modal = new TagSuggestModal({}, { basename: '日本語のノート' }, [
    { tag: '研究', score: 0.8, whyCount: 2, structureFit: 0.6 },
  ], tags => { submitted = tags; });
  modal.onOpen();
  assert.ok(text(modal.contentEl).includes('Tag suggestions: 日本語のノート'));
  assert.ok(text(modal.contentEl).includes('Existing tags'));
  assert.ok(text(modal.contentEl).includes('Supported by 2 similar notes'));
  const free = walk(modal.contentEl).find(element => element.tag === 'input' && element.attributes.type === 'text');
  free.value = '独自タグ custom';
  walk(modal.contentEl).find(element => element.textContent === 'Add selected tags').listeners.click();
  assert.deepEqual(Array.from(submitted), ['研究', '独自タグ', 'custom']);
});

test('English related-file empty state and Base creation labels are translated', () => {
  const f = fixture();
  const { renderExternalFiles } = f.load('external-files-view');
  const manager = new Element('div');
  renderExternalFiles({}, manager, null, { CSS_CLASS: {}, EVENT: {}, section: (parent, key, title) => {
    const section = parent.createEl('details'); section.createEl('summary', { text: title }); return section;
  } });
  assert.ok(text(manager).includes('Open a note to manage its related files'));
  assert.ok(text(manager).includes('Linked files (0)'));
  assert.ok(text(manager).includes('No related files'));
  const { BaseNameModal } = f.load('base-modal');
  const modal = new BaseNameModal({}); modal.onOpen();
  assert.equal(modal.title, 'Create a new Base');
  const input = walk(modal.contentEl).find(element => element.tag === 'input');
  input.value = '自分のビュー';
  walk(modal.contentEl).find(element => element.textContent === 'Create').listeners.click();
  assert.equal(modal.result, '自分のビュー');
});
