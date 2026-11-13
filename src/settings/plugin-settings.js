// 設定の既定値・読み込み・正規化・更新規則を集約する。Obsidian APIや保存操作は持たない。
//
// 管理フォルダの正本は、プラグインインスタンスが持つstate.foldersだけ。
// loadSettingsは独立した設定を返し、モジュール内に現在のVaultの設定を保存しない。
// 利用側はstate.foldersの参照、または最新値を返すgetterを受け取る。
// setFolderとresetUserSettingsはその参照を維持して更新するため、Base等の利用側も即時に追従する。
// 保存のタイミングと入力検証メッセージは、呼び出すワークフロー・設定画面の責務。

// ---- 画像として扱う拡張子 ----------------------------------------
// 画像として扱う拡張子と、その MIME タイプの対応。拡張子は小文字・ドットなし。
// 「どの拡張子を画像とみなすか」と「表示時に何の MIME タイプで渡すか」を、ここ1か所で決める。
// 以前は CONFIG.imageExtensions と、external-image-embed.js 内の対応表に同じ拡張子の知識が別々にあり、
// 片方だけに足すと、画像として扱われるのに表示されない（MIME が不定になる）状態になりえた。
// ここに足した拡張子は、次の両方の対象になる。
//   ・サムネイル生成（thumbnail.js の makeThumbnail が createImageBitmap で読み込む）
//   ・埋め込み表示（external-image-embed.js が Blob の MIME タイプにこの値を使う）
const IMAGE_MIME_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

// ---- 既定値 --------------------------------------------------
// Vault構成や動作条件を変更するときは、まずこのブロックを確認する。
// フォルダ、表示、色、タグ提案などの利用者設定はloadSettingsで保存状態へ補う。
// それ以外は開発者向けの固定値。値の意味はコメントを参照。
const CONFIG = {
  folders: { meta: "_meta", thumb: "_thumbs", base: "_bases" },
  properties: { links: "links" },
  thumbnailMaxEdge: 256, // サムネイルの長辺(px)
  imageExtensions: new Set(Object.keys(IMAGE_MIME_TYPES)), // 画像として扱う拡張子（上の対応表のキー）
  trashOnRemove: false, // true: 「✕」でメタノートとサムネイルも同時にゴミ箱へ
  graphPlanarColor: "#ad8bfe", // 平面色
  clusterHighlightColor: "#ffae70", // 密・平面の既定色
  graphNonPlanarColor: "#fe8bc8", // 非平面色
  primitiveAreaColor: "#70c9c0", // 素領域リストの既定色（青緑）
  graphUndeterminedColor: "#8792a2", // 未判定部分の既定色（灰青）
  maxFindings: 200, // K5・K3,3 それぞれの検出上限
  maintenanceDelay: 1500, // 再計算までの待ち時間(ms)
  maxImageBytes: 32 * 1024 * 1024,
  maxImageCacheBytes: 128 * 1024 * 1024,
  maxImageCacheEntries: 64,
  analysisTimeLimit: 10000,
};

// 初期設定と設定画面のリセットで使う既定値。
const DEFAULT_FOLDERS = CONFIG.folders;
const PARTIAL_GRAPH_NODE_LIMITS = [30, 60, 90, 150, 200, 300, 500, 750, 1200];
const DEFAULT_PARTIAL_GRAPH_NODE_LIMIT = 90;
const DEFAULT_TAG_STOP_WORDS = [
  "メモ", "ノート", "まとめ", "概要", "はじめに", "目次", "参考", "その他", "備考",
];

function normalizeTagStopWords(value) {
  if (!Array.isArray(value)) return [...DEFAULT_TAG_STOP_WORDS];
  return [...new Set(value.map((word) => String(word).trim().toLowerCase()).filter(Boolean))];
}

// 既存の呼び出し口も維持し、表示設定の仕様は専用モジュールへ集約する。
const { normalizeWindowAppearance, normalizeWindowPlacement } = require('./window-appearance');
const { normalizeWebThumbnailFiles } = require('../web-thumbnail/web-thumbnail-data');

// 保存されたpx座標を検証する。画面サイズに応じた補正は表示時に行う。
function normalizeWindowPosition(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y)
    ? { x: value.x, y: value.y }
    : null;
}

function normalizeAllowedOrphanFolder(value) {
  if (typeof value !== 'string') return null;
  const folder = value.trim().replace(/\/+$/, '');
  if (!folder) return value.trim() ? null : '';
  if (folder.startsWith('/') || /[\\:]/.test(folder) || folder.split('/').some(part => !part || part === '.' || part === '..')) return null;
  return folder;
}

// ---- 保存データの読み込み --------------------------------------
// 保存済みデータ（loadData の結果。未保存なら {}）から、実行時の state を組み立てる。
// 管理フォルダの正本は返すstate.foldersだけとし、モジュールのグローバル状態は変更しない。
//
// 【入力】 saved: プラグインの loadData() の結果。Obsidian が Vault 内の
//   `.obsidian/plugins/<プラグインID>/data.json` に JSON で保存しているオブジェクトで、
//   プラグインを初めて使うときは null になる（呼び出し側で {} にしてから渡す）。
//   このプラグインが書く項目は次のとおり（すべて省略されうる。保存は saveData(state) で state 全体）。
//     folders                : { meta, thumb, base } 管理フォルダ名（Vault 相対パス、前後に "/" なし）
//     graphPlanarColor       : 平面ノートのグラフ色（#RRGGBB）
//     clusterHighlightColor  : 密・平面の結合領域色（#RRGGBB。旧設定キーを維持）
//     graphNonPlanarColor    : 非平面ノートのグラフ色（#RRGGBB）
//     visible                : 小窓を表示するか（boolean）
//     pos / detailPos        : 小窓・詳細窓の位置 { x, y }（px）。未設定は null か無し
//     sections               : 小窓内の各欄の開閉 { orphan, planar, bases, assets, fileManagement }（boolean）
//     graphColorGroupQueries : 前回、標準グラフに追加した分類色グループの検索式一覧。
// 【出力】 実行時の state オブジェクト（呼び出し側が this.state に持つ）。
//   state は保存データの全項目（知らないキーも含む）に、既定値を補ったもの。
//
// 方針:
//   - 保存済みの値は尊重し、知らないキーも消さずに引き継ぐ（...saved）。
//     別バージョンのプラグインが書いた値を、読み込み→保存で失わないため。
//   - 後から追加された設定には既定値を補う。
//
// state.foldersは各設定インスタンスに独立して作る。更新とリセットでは同じ参照を維持する。
function loadSettings(saved) {
  return {
    ...saved,
    folders: { ...DEFAULT_FOLDERS, ...saved.folders },
    windowAppearance: normalizeWindowAppearance(saved.windowAppearance),
    windowPlacement: normalizeWindowPlacement(saved.windowPlacement),
    webThumbnailFiles: normalizeWebThumbnailFiles(saved.webThumbnailFiles),
    orphanAllowedFolder: normalizeAllowedOrphanFolder(saved.orphanAllowedFolder ?? '') ?? '',
    // 一時的に平面色へ適用していたオレンジの既定値を青紫へ戻す。
    graphPlanarColor: saved.graphPlanarColor === '#f29a40'
      ? CONFIG.graphPlanarColor : saved.graphPlanarColor ?? CONFIG.graphPlanarColor,
    primitiveAreaColor: saved.primitiveAreaColor ?? CONFIG.primitiveAreaColor,
    partialGraphNodeLimit: PARTIAL_GRAPH_NODE_LIMITS.includes(saved.partialGraphNodeLimit)
      ? saved.partialGraphNodeLimit : DEFAULT_PARTIAL_GRAPH_NODE_LIMIT,
    graphUndeterminedColor: saved.graphUndeterminedColor ?? CONFIG.graphUndeterminedColor,
    clusterHighlightColor: saved.clusterHighlightColor ?? CONFIG.clusterHighlightColor,
    graphNonPlanarColor: saved.graphNonPlanarColor ?? CONFIG.graphNonPlanarColor,
    tagStopWords: normalizeTagStopWords(saved.tagStopWords),
    enableExternalImageEmbeds: saved.enableExternalImageEmbeds === true,
    visible: saved.visible ?? true,
    pos: normalizeWindowPosition(saved.pos),
    detailPos: normalizeWindowPosition(saved.detailPos),
    areaWindowVisible: saved.areaWindowVisible === true,
    orphanWindowVisible: saved.orphanWindowVisible === true,
    orphanPos: normalizeWindowPosition(saved.orphanPos),
    graphPos: normalizeWindowPosition(saved.graphPos),
    graphSize: saved.graphSize && Number.isFinite(saved.graphSize.width) && Number.isFinite(saved.graphSize.height)
      && saved.graphSize.width > 0 && saved.graphSize.height > 0
      ? { width: saved.graphSize.width, height: saved.graphSize.height } : null,
    pendingImport: saved.pendingImport && typeof saved.pendingImport.mainNotePath === "string" && Array.isArray(saved.pendingImport.paths)
      ? { ...saved.pendingImport, paths: [...new Set(saved.pendingImport.paths.filter(value => typeof value === "string"))] }
      : null,
    sections: Object.assign(
      {
        orphan: true,
        planar: true,
        bases: true,
        assets: true,
        fileManagement: false,
      },
      saved.sections,
    ),
  };
}

// ---- 設定の更新 ------------------------------------------------
// 以下の関数は state を書き換えるだけで、保存（saveData）はしない。
// 保存のタイミングは呼び出し側が決める（複数の変更をまとめて1回で保存できるように）。
// 入力値の検証も呼び出し側の責務。ここへ渡る値は検証済みであることを前提にする。

// 管理フォルダ1件の変更。実行時も保存時も、このオブジェクトだけを使う。
function setFolder(state, key, folder) {
  state.folders[key] = folder;
}

// 「設定を初期値に戻す」。利用者が変更できる設定を既定値へ戻す。
// 小窓の位置・表示状態・折りたたみなどは、設定ではなく利用状況なので保持する。
// 設定項目を増やしたときは、ここに追加しないとリセットで戻らない点に注意。
function resetUserSettings(state) {
  state.windowAppearance = normalizeWindowAppearance();
  state.windowPlacement = normalizeWindowPlacement();
  state.orphanAllowedFolder = '';
  Object.assign(state.folders, DEFAULT_FOLDERS);
  state.graphPlanarColor = CONFIG.graphPlanarColor;
  state.primitiveAreaColor = CONFIG.primitiveAreaColor;
  state.graphUndeterminedColor = CONFIG.graphUndeterminedColor;
  state.partialGraphNodeLimit = DEFAULT_PARTIAL_GRAPH_NODE_LIMIT;
  state.clusterHighlightColor = CONFIG.clusterHighlightColor;
  state.graphNonPlanarColor = CONFIG.graphNonPlanarColor;
  state.tagStopWords = [...DEFAULT_TAG_STOP_WORDS];
  state.enableExternalImageEmbeds = false;
}

// 強調色の取得。loadSettings で既定値は補っているが、state が未初期化の経路でも
// 色が undefined にならないよう、フォールバックの定義をここ1か所に持つ。
function getHighlightColor(state) {
  return state.clusterHighlightColor ?? CONFIG.clusterHighlightColor;
}

module.exports = {
  normalizeWindowAppearance,
  IMAGE_MIME_TYPES,
  CONFIG,
  DEFAULT_FOLDERS,
  PARTIAL_GRAPH_NODE_LIMITS,
  DEFAULT_PARTIAL_GRAPH_NODE_LIMIT,
  DEFAULT_TAG_STOP_WORDS,
  normalizeTagStopWords,
  normalizeAllowedOrphanFolder,
  loadSettings,
  setFolder,
  resetUserSettings,
  getHighlightColor,
};
