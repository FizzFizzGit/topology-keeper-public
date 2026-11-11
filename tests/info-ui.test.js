const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderInfoContent } = require('../src/info-content');
const { sectionHelp } = require('../src/section-help');
const { attachInfoPopover, hideInfoPopover, disposeInfoPopover } = require('../src/info-popover');
const { createTranslator } = require('../src/i18n-core');
const { APPEARANCE_FIELDS } = require('../src/window-appearance');
const { dictionaries } = require('../src/ui-dictionary');

// Obsidian拡張DOMを持たない最小要素。標準DOMだけの依存であることも確認する。
class Element {
  constructor(doc, tag) { this.ownerDocument = doc; this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.style = {}; this.textContent = ''; }
  appendChild(child) { this.children.push(child); return child; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback); }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name, event = {}) { for (const callback of this.listeners.get(name) ?? []) callback(event); }
  getBoundingClientRect() { return { top: 140, bottom: 160, right: 300, height: 60 }; }
}
function fixture() {
  const doc = { defaultView: { innerWidth: 400, innerHeight: 300 }, createElement(tag) { return new Element(this, tag); } };
  return { doc, button: doc.createElement('button'), tip: doc.createElement('div') };
}
const walk = element => [element, ...element.children.flatMap(walk)];
const text = element => walk(element).map(node => node.textContent).join('');

test('info renderer preserves paragraphs, list groups, headings and literal HTML without host APIs', () => {
  const { tip } = fixture();
  renderInfoContent(tip, '### Heading\n\nParagraph **bold**\ncontinued\n\n- First\n- <img src=x>\n\nLast paragraph');
  assert.deepEqual(tip.children.map(node => node.tag), ['h4', 'p', 'ul', 'p']);
  assert.equal(tip.children[2].children.length, 2);
  assert.ok(walk(tip).some(node => node.tag === 'strong' && node.textContent === 'bold'));
  assert.equal(walk(tip).some(node => node.tag === 'img'), false);
  assert.ok(text(tip).includes('<img src=x>'));
  assert.ok(text(tip).includes('bold continued'));
});

test('popover closes immediately and stays open when moving between the button and explanation', () => {
  const f = fixture();
  attachInfoPopover(f.button, f.tip);
  f.button.emit('focus');
  assert.equal(f.tip.attributes.has('hidden'), false);
  assert.equal(f.button.attributes.get('aria-expanded'), 'true');
  assert.equal(f.tip.style.width, '320px');
  assert.equal(f.tip.style.top, '140px');
  f.button.emit('mouseleave', { relatedTarget: f.tip });
  assert.equal(f.tip.attributes.has('hidden'), false);
  f.tip.emit('mouseleave');
  assert.equal(f.tip.attributes.has('hidden'), true);
  f.button.emit('mouseenter');
  f.button.emit('mouseleave');
  assert.equal(f.tip.attributes.has('hidden'), true);
  disposeInfoPopover(f.tip);
  assert.equal(f.tip.attributes.has('hidden'), true);
  for (const listeners of f.button.listeners.values()) assert.equal(listeners.size, 0);
  for (const listeners of f.tip.listeners.values()) assert.equal(listeners.size, 0);
  disposeInfoPopover(f.tip);
});

test('popover keyboard and external dismissal update accessibility state immediately', () => {
  const f = fixture();
  attachInfoPopover(f.button, f.tip);
  const key = value => f.button.emit('keydown', { key: value, preventDefault() {} });
  key('Enter');
  key('Escape');
  assert.equal(f.button.attributes.get('aria-expanded'), 'false');
  key(' ');
  f.button.emit('blur');
  assert.equal(f.tip.attributes.has('hidden'), true);
  key(' ');
  hideInfoPopover(f.tip);
  assert.equal(f.button.attributes.get('aria-expanded'), 'false');
  disposeInfoPopover(f.tip);
});

test('section help and dynamically referenced settings keys are complete in both languages', () => {
  for (const language of ['ja', 'en']) {
    const t = createTranslator(language);
    for (const field of APPEARANCE_FIELDS) {
      for (const id of [field.name, field.description, field.defaultLabel].filter(Boolean))
        assert.ok(Object.hasOwn(dictionaries[language], id), id);
    }
    for (const key of ['orphan', 'managedOrphan', 'bases', 'assets', 'planar', 'distanceAreas']) {
      const help = sectionHelp(key, t);
      assert.ok(help.includes('### '));
      assert.equal(/\b(?:settings|window|area|info)\.[A-Za-z]/.test(help), false);
      if (language === 'en') assert.equal(/[\u3040-\u30ff\u4e00-\u9fff]/.test(help), false);
    }
    assert.ok(sectionHelp('planar', t).includes(t('area.classificationDensePlanar')));
    assert.ok(sectionHelp('planar', t).includes(t('area.primitiveHelp')));
    const distanceHelp = sectionHelp('distanceAreas', t);
    assert.ok(distanceHelp.includes(`### ${t('info.distance')}`));
    assert.ok(distanceHelp.includes(`### ${t('info.kuratowski')}`));
  }
});
