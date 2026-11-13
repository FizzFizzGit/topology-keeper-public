const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');

// Obsidian本体を起動せずに操作口を差し替える共通入口。
// 何を模擬するかはテスト側で明示する。未指定の依存は実モジュールを読む。
function loadSource(name, overrides = {}, globals = {}) {
  const filename = require.resolve(path.join(__dirname, '../../src', name));
  const nativeRequire = createRequire(filename);
  const context = { module: { exports: {} }, console, URL, ...globals,
    require: id => Object.hasOwn(overrides, id) ? overrides[id]
      : id.endsWith('/i18n') ? { t: require('../../src/i18n/i18n-core').createTranslator('ja') } : nativeRequire(id) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}
module.exports = { loadSource };
