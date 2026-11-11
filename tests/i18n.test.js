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
        addOption() { return this; }, setButtonText() { return this; }, setWarning() { return this; },
        onChange(callback) { this.change = callback; return this; }, onClick(callback) { this.click = callback; return this; } };
      controls.push(control); callback(control); return this;
    }
    addDropdown(callback) { return this.control(callback); }
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
      : id === './i18n' ? { t: createTranslator(language) } : require('../src/' + id.replace('./', '')),
  });
  const state = require('../src/plugin-settings').loadSettings({ orphanAllowedFolder: '未分類', tagStopWords: ['固有の語'],
    pendingImport: { mainNotePath: '資料/元ノート.md', paths: [] } });
  let appearanceUpdates = 0;
  const plugin = { state, applyWindowAppearance() { appearanceUpdates++; }, saveData: async () => {}, scheduleMaint() {}, resetWindowPositions: async () => {},
    importWorkflow: { recover: async () => {}, discardRecovery: async () => {} } };
  const tab = new module.exports({}, plugin, { CSS_CLASS: {} });
  tab.display();
  return { names, descriptions, values, headings, controls, notices, plugin, appearanceUpdates: () => appearanceUpdates };
}

test('settings render in either language while stored folders, words and keys remain unchanged', async () => {
  const english = settingsFixture('en');
  assert.ok(english.names.includes('Folder excluded from isolation checks'));
  assert.ok(english.headings.includes('Graph display'));
  assert.ok(english.descriptions.some(text => text.includes('資料/元ノート.md')));
  assert.ok(english.values.includes('未分類'));
  assert.ok(english.values.includes('固有の語'));
  assert.equal(english.names.some(name => /[\u3040-\u30ff\u4e00-\u9fff]/.test(name)), false);
  await english.controls.find(control => control.click).click();
  assert.ok(english.notices.includes('Window positions have been reset.'));
  const japanese = settingsFixture('ja');
  assert.ok(japanese.names.includes('孤立チェック対象外のフォルダ'));
  assert.ok(japanese.headings.includes('グラフ表示'));
  assert.equal(japanese.plugin.state.orphanAllowedFolder, '未分類');
});

test('common appearance controls apply immediately, survive reload and reset without moving saved windows', async () => {
  const { loadSettings, resetUserSettings } = require('../src/plugin-settings');
  const f = settingsFixture('ja');
  await f.controls[0].change('120');
  await f.controls[1].change('70');
  await f.controls[2].change('480');
  assert.equal(f.appearanceUpdates(), 3);
  assert.deepEqual(f.plugin.state.windowAppearance, { fontScale: 120, maxHeightPercent: 70, widthPx: 480, minHeightPx: 280, minWidthPx: 280 });
  const restored = loadSettings(JSON.parse(JSON.stringify({ ...f.plugin.state, pos: { x: 40, y: 80 } })));
  assert.deepEqual(restored.windowAppearance, { fontScale: 120, maxHeightPercent: 70, widthPx: 480, minHeightPx: 280, minWidthPx: 280 });
  resetUserSettings(restored);
  assert.deepEqual(restored.windowAppearance, { fontScale: 100, maxHeightPercent: 0, widthPx: 0, minHeightPx: 280, minWidthPx: 280 });
  assert.deepEqual(restored.pos, { x: 40, y: 80 });
  assert.deepEqual(loadSettings({ windowAppearance: { fontScale: 'large', maxHeightPercent: null } }).windowAppearance,
    { fontScale: 100, maxHeightPercent: 0, widthPx: 0, minHeightPx: 280, minWidthPx: 280 });
  assert.deepEqual(loadSettings({ windowAppearance: { fontScale: 900, maxHeightPercent: -5 } }).windowAppearance,
    { fontScale: 140, maxHeightPercent: 50, widthPx: 0, minHeightPx: 280, minWidthPx: 280 });
});

test('minimum height is independently saved, accepts no minimum and restores its default', async () => {
  const { loadSettings, resetUserSettings } = require('../src/plugin-settings');
  const f = settingsFixture('en');
  assert.ok(f.names.includes('Minimum height'));
  await f.controls[3].change('160');
  assert.equal(f.plugin.state.windowAppearance.minHeightPx, 160);
  assert.equal(f.plugin.state.windowAppearance.maxHeightPercent, 0);
  const restored = loadSettings(JSON.parse(JSON.stringify(f.plugin.state)));
  assert.equal(restored.windowAppearance.minHeightPx, 160);
  await f.controls[3].change('0');
  assert.equal(f.plugin.state.windowAppearance.minHeightPx, 0);
  assert.equal(f.appearanceUpdates(), 2);
  resetUserSettings(restored);
  assert.equal(restored.windowAppearance.minHeightPx, 280);
  assert.equal(loadSettings({ windowAppearance: { minHeightPx: -10 } }).windowAppearance.minHeightPx, 0);
  assert.equal(loadSettings({ windowAppearance: { minHeightPx: 9999 } }).windowAppearance.minHeightPx, 640);
});

test('minimum width is independent from the saved window width and survives reload', async () => {
  const { loadSettings, resetUserSettings } = require('../src/plugin-settings');
  const f = settingsFixture('en');
  assert.ok(f.names.includes('Minimum width'));
  assert.ok(f.names.includes('Window width'));
  await f.controls[2].change('480');
  await f.controls[4].change('200');
  assert.equal(f.plugin.state.windowAppearance.widthPx, 480);
  assert.equal(f.plugin.state.windowAppearance.minWidthPx, 200);
  const restored = loadSettings(JSON.parse(JSON.stringify(f.plugin.state)));
  assert.equal(restored.windowAppearance.minWidthPx, 200);
  assert.equal(restored.windowAppearance.widthPx, 480);
  await f.controls[4].change('0');
  assert.equal(f.plugin.state.windowAppearance.minWidthPx, 0);
  assert.equal(f.plugin.state.windowAppearance.widthPx, 480);
  resetUserSettings(restored);
  assert.equal(restored.windowAppearance.minWidthPx, 280);
  assert.equal(restored.windowAppearance.widthPx, 0);
  assert.equal(loadSettings({ windowAppearance: { widthPx: 320 } }).windowAppearance.minWidthPx, 280);
});
