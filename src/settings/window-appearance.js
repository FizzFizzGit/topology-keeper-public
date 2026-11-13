// アプリ固有の表示設定。DOM・Obsidian・翻訳辞書を参照しない純粋な設定モジュール。
// 汎用ライブラリportable-windowはこのファイルを参照せず、受け取った値だけを適用する。
// 幅は指定値に固定し、既定は280px。高さは内容に合わせて上下限の間で伸縮する。
const DEFAULT_WINDOW_SIZE = 280;
const WINDOW_PLACEMENTS = [
  ['main', 'settings.mainWindowPlacement', 'network'],
  ['planar', 'window.analysis', 'chart-no-axes-combined'],
  ['orphan', 'common.orphan', 'unplug'],
  ['graph', 'graph.title', 'git-fork'],
];
const PLACEMENT_CHOICES = ['floating', 'left', 'right'];

function normalizeWindowPlacement(value) {
  return Object.fromEntries(WINDOW_PLACEMENTS.map(([kind]) =>
    [kind, PLACEMENT_CHOICES.includes(value?.[kind]) ? value[kind] : 'floating']));
}
const APPEARANCE_FIELDS = [
  { key: 'fontScale', name: 'settings.windowFontScale', description: 'settings.windowFontScaleDesc',
    choices: [80, 90, 100, 110, 120, 130, 140], unit: '%' },
  { key: 'maxHeightPercent', name: 'settings.windowMaxHeight', description: 'settings.windowMaxHeightDesc',
    choices: [0, 50, 60, 70, 80, 90, 95, 100], unit: '%', defaultLabel: 'settings.windowDefaultHeight' },
  { key: 'widthPx', name: 'settings.windowWidth', description: 'settings.windowWidthDesc',
    choices: [0, 240, 280, 320, 400, 480, 560, 640], unit: 'px', defaultLabel: 'settings.windowDefaultWidth' },
  { key: 'minHeightPx', name: 'settings.windowMinHeight', description: 'settings.windowMinHeightDesc',
    choices: [0, 120, 160, 200, 240, 280, 320, 400, 480, 640], unit: 'px', defaultLabel: 'settings.windowNoMinHeight' },
  { key: 'minWidthPx', name: 'settings.windowMinWidth', description: 'settings.windowMinWidthDesc',
    choices: [0, 160, 200, 240, 280, 320, 400, 480, 560, 640], unit: 'px', defaultLabel: 'settings.windowNoMinWidth' },
];

/** 保存データを読み、既知の表示項目だけを新しいオブジェクトとして返す。入力は変更しない。 */
function normalizeWindowAppearance(value) {
  return {
    fontScale: Number.isFinite(value?.fontScale) ? Math.round(Math.max(80, Math.min(140, value.fontScale))) : 100,
    widthPx: Number.isFinite(value?.widthPx) && value.widthPx !== 0
      ? Math.round(Math.max(240, Math.min(640, value.widthPx))) : 0,
    minHeightPx: Number.isFinite(value?.minHeightPx)
      ? Math.round(Math.max(0, Math.min(640, value.minHeightPx))) : DEFAULT_WINDOW_SIZE,
    minWidthPx: Number.isFinite(value?.minWidthPx)
      ? Math.round(Math.max(0, Math.min(640, value.minWidthPx))) : DEFAULT_WINDOW_SIZE,
    maxHeightPercent: Number.isFinite(value?.maxHeightPercent) && value.maxHeightPercent !== 0
      ? Math.round(Math.max(50, Math.min(100, value.maxHeightPercent))) : 0,
  };
}

module.exports = { DEFAULT_WINDOW_SIZE, APPEARANCE_FIELDS, normalizeWindowAppearance,
  WINDOW_PLACEMENTS, PLACEMENT_CHOICES, normalizeWindowPlacement };
