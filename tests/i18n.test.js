const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { dictionaries } = require('../src/ui-dictionary');
const { createTranslator, normalizeLanguage } = require('../src/i18n-core');
const placeholders = message => [...message.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('Japanese and English dictionaries have identical keys and interpolation arguments', () => {
  assert.deepEqual(Object.keys(dictionaries.ja).sort(), Object.keys(dictionaries.en).sort());
  for (const key of Object.keys(dictionaries.ja)) {
    assert.equal(typeof dictionaries.en[key], 'string', key);
    assert.ok(dictionaries.en[key].length, key);
    assert.deepEqual(placeholders(dictionaries.ja[key]), placeholders(dictionaries.en[key]), key);
  }
});

test('language resolution, English fallback, singular counts and literal user text are preserved', () => {
  for (const language of ['ja', 'ja-JP', 'JA_jp']) assert.equal(normalizeLanguage(language), 'ja');
  for (const language of ['en', 'fr', 'zh', '', null]) assert.equal(normalizeLanguage(language), 'en');
  assert.equal(createTranslator('en')('count.notes', { count: 1 }), '1 note');
  assert.equal(createTranslator('en')('count.notes', { count: 2 }), '2 notes');
  assert.equal(createTranslator('ja')('count.notes', { count: 1 }), '1ノート');
  const path = '日本語/{count}/$&.md';
  assert.ok(createTranslator('en')('settings.pendingDesc', { path }).includes(path));
  assert.equal(createTranslator('ja', { ja: {}, en: { only: 'English {value}' } })('only', { value: 0 }), 'English 0');
  assert.equal(createTranslator('ja')('unknown.key'), 'unknown.key');
  assert.ok(createTranslator('en')('settings.pendingDesc').includes('{path}'));
});

test('runtime translator follows the Obsidian language without relying on browser language', () => {
  let language = 'ja';
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/i18n'), 'utf8'), {
    module, require: id => id === 'obsidian' ? { getLanguage: () => language } : require('../src/i18n-core'),
  });
  assert.equal(module.exports.t('common.close'), '閉じる');
  language = 'en';
  assert.equal(module.exports.t('common.close'), 'Close');
  language = 'fr';
  assert.equal(module.exports.t('common.close'), 'Close');
});

test('all static translation calls refer to dictionary entries', () => {
  for (const name of fs.readdirSync(require('node:path').join(__dirname, '../src'))) {
    if (!name.endsWith('.js')) continue;
    const source = fs.readFileSync(require.resolve('../src/' + name), 'utf8');
    for (const match of source.matchAll(/\bt\(['"]([^'"]+)['"]/g))
      assert.ok(Object.hasOwn(dictionaries.en, match[1]), `${name}: ${match[1]}`);
  }
});

function settingsFixture(language) {
  const names = [], descriptions = [], values = [], headings = [], controls = [], notices = [];
  class Setting {
    setName(value) { names.push(value); return this; }
    setDesc(value) { descriptions.push(value); return this; }
    control(callback) {
      const control = { setValue(value) { values.push(value); return this; }, setPlaceholder() { return this; },
        setButtonText() { return this; }, setWarning() { return this; },
        onChange(callback) { this.change = callback; return this; }, onClick(callback) { this.click = callback; return this; } };
      controls.push(control); callback(control); return this;
    }
    addButton(callback) { return this.control(callback); }
    addText(callback) { return this.control(callback); }
    addTextArea(callback) { return this.control(callback); }
    addToggle(callback) { return this.control(callback); }
    addColorPicker(callback) { return this.control(callback); }
  }
  const container = { empty() {}, createEl(tag, options) { headings.push(options.text); } };
  class PluginSettingTab { constructor() { this.containerEl = container; } }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/settings-tab'), 'utf8'), {
    module, require: id => id === 'obsidian' ? { PluginSettingTab, Setting, Notice: class { constructor(text) { notices.push(text); } } }
      : id === './i18n' ? { t: createTranslator(language) } : require('../src/plugin-settings'),
  });
  const state = require('../src/plugin-settings').loadSettings({ orphanAllowedFolder: '未分類', tagStopWords: ['固有の語'],
    pendingImport: { mainNotePath: '資料/元ノート.md', paths: [] } });
  const plugin = { state, saveData: async () => {}, scheduleMaint() {}, resetWindowPositions: async () => {},
    importWorkflow: { recover: async () => {}, discardRecovery: async () => {} } };
  const tab = new module.exports({}, plugin, { CSS_CLASS: {} });
  tab.display();
  return { names, descriptions, values, headings, controls, notices, plugin };
}

test('settings render in either language while stored folders, words and keys remain unchanged', async () => {
  const english = settingsFixture('en');
  assert.ok(english.names.includes('Folder excluded from isolation checks'));
  assert.ok(english.headings.includes('Graph display'));
  assert.ok(english.descriptions.some(text => text.includes('資料/元ノート.md')));
  assert.ok(english.values.includes('未分類'));
  assert.ok(english.values.includes('固有の語'));
  assert.equal(english.names.some(name => /[\u3040-\u30ff\u4e00-\u9fff]/.test(name)), false);
  await english.controls[0].click();
  assert.ok(english.notices.includes('Window positions have been reset.'));
  const japanese = settingsFixture('ja');
  assert.ok(japanese.names.includes('孤立チェック対象外のフォルダ'));
  assert.ok(japanese.headings.includes('グラフ表示'));
  assert.equal(japanese.plugin.state.orphanAllowedFolder, '未分類');
});
