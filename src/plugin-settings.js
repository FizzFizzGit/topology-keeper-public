// 設定値と「管理フォルダ」構成の置き場。
//
// 【このファイルを作った理由】
// 設定まわりの知識が main.js と settings-tab.js に散らばっていた。
//   - 既定値（CONFIG）と、実行時に変わるフォルダ名（FOLDERS）の定義
//   - 保存データの読み込みと、旧バージョンとの互換処理
//   - 「FOLDERS を変えたら state.folders も同期する」という手作業の同期
//   - 強調色が未設定のときの既定値フォールバック
// これらを分散させたままだと、設定項目を1つ足すたびに複数ファイルを直す必要があり、
// 既定値や互換性の扱いが場所ごとにずれやすい。ここに集めて、変更箇所を1ファイルにする。
//
// 【責務の境界】
//   ここに置くもの : 既定値、実行時の共有フォルダ構成、保存データの正規化、設定の更新規則
//   ここに置かないもの: 設定画面のUI・入力検証メッセージ（settings-tab.js）、
//                      saveData の呼び出し（呼び出し側が保存タイミングを決める）、
//                      小窓の描画など設定と無関係な状態管理（main.js）
//   このファイルは Obsidian API に依存させない。単体で読んで理解できる状態を保つため。

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
// 利用者が設定画面から変えられるのは folders、グラフ分類色、タグ提案のストップワード。
// それ以外は開発者向けの固定値。値の意味はコメントを参照。
const CONFIG = {
  folders: { meta: "_meta", thumb: "_thumbs", base: "_bases" },
  properties: { links: "links" },
  thumbnailMaxEdge: 256, // サムネイルの長辺(px)
  imageExtensions: new Set(Object.keys(IMAGE_MIME_TYPES)), // 画像として扱う拡張子（上の対応表のキー）
  trashOnRemove: false, // true: 「✕」でメタノートとサムネイルも同時にゴミ箱へ
  graphPlanarColor: "#ad8bfe", // 平面ノートの既定色
  clusterHighlightColor: "#ffae70", // ホットスポットの既定色
  graphNonPlanarColor: "#fe8bc8", // 非平面ノートの既定色
  primitiveAreaColor: "#70c9c0", // 素領域リストの既定色（青緑）
  graphUndeterminedColor: "#8792a2", // 未判定部分の既定色（灰青）
  maxFindings: 200, // K5・K3,3 それぞれの検出上限
  maintenanceDelay: 1500, // 再計算までの待ち時間(ms)
  maxImageBytes: 32 * 1024 * 1024,
  maxImageCacheBytes: 128 * 1024 * 1024,
  maxImageCacheEntries: 64,
  analysisTimeLimit: 10000,
};

// 設定画面の初期化と、旧バージョンからの設定読み込みの両方で使う既定値。
const DEFAULT_FOLDERS = CONFIG.folders;
const DEFAULT_TAG_STOP_WORDS = [
  "メモ", "ノート", "まとめ", "概要", "はじめに", "目次", "参考", "その他", "備考",
];

function normalizeTagStopWords(value) {
  if (!Array.isArray(value)) return [...DEFAULT_TAG_STOP_WORDS];
  return [...new Set(value.map((word) => String(word).trim().toLowerCase()).filter(Boolean))];
}

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

// 実行時に有効なフォルダ構成。設定画面で変更される。
//
// 【重要な前提】このオブジェクトは「参照のまま」複数の場所に渡されている
// （BaseManager、孤立判定、isManagedPath など）。
// そのため、再代入（FOLDERS = {...}）してはいけない。必ず Object.assign などで
// 中身だけを書き換える。再代入すると、渡し済みの参照だけが古い値のまま残り、
// 「設定を変えたのに一部の処理だけ旧フォルダを見ている」不具合になる。
const FOLDERS = { ...DEFAULT_FOLDERS };

// ---- フォルダ構成の参照 ----------------------------------------
// 管理フォルダ配下のパスか。FOLDERS の現在値を見るので、設定変更が即座に反映される。
// 管理フォルダのファイルは、通常ノートのグラフ・タグ提案・孤立判定の対象から外す
// 判断に使われる。判断基準が1か所にあるよう、FOLDERS のすぐ隣に置いている。
const isManagedPath = (p) =>
  Object.values(FOLDERS).some((f) => p.startsWith(`${f}/`));

// ---- 保存データの読み込み --------------------------------------
// 保存済みデータ（loadData の結果。未保存なら {}）から、実行時の state を組み立てる。
// あわせて FOLDERS へ保存済みのフォルダ名を反映する。
//
// 【入力】 saved: プラグインの loadData() の結果。Obsidian が Vault 内の
//   `.obsidian/plugins/<プラグインID>/data.json` に JSON で保存しているオブジェクトで、
//   プラグインを初めて使うときは null になる（呼び出し側で {} にしてから渡す）。
//   このプラグインが書く項目は次のとおり（すべて省略されうる。保存は saveData(state) で state 全体）。
//     folders                : { meta, thumb, base } 管理フォルダ名（Vault 相対パス、前後に "/" なし）
//     graphPlanarColor       : 平面ノートのグラフ色（#RRGGBB）
//     clusterHighlightColor  : ホットスポットのグラフ色（#RRGGBB。旧設定キーを維持）
//     graphNonPlanarColor    : 非平面ノートのグラフ色（#RRGGBB）
//     visible                : 小窓を表示するか（boolean）
//     collapsed              : boolean。保存・復元はされるが、現在のコードにはこの値を読む箇所が無い
//                              （loadSettings では旧キー maintCollapsed から引き継ぐだけ）
//     pos / detailPos        : 小窓・詳細窓の位置 { x, y }（px）。未設定は null か無し
//     sections               : 小窓内の各欄の開閉 { orphan, planar, bases, assets, fileManagement }（boolean）
//     graphColorGroupQueries : 前回、標準グラフに追加した分類色グループの検索式一覧。旧
//     graphHighlightQuery    : 旧版の単一ホットスポット色グループの検索式（移行時に置き換える）
//   旧バージョンのキー maintVisible / maintCollapsed / maintPos / maintSections も読む（下記）。
// 【出力】 実行時の state オブジェクト（呼び出し側が this.state に持つ）。
//   state は保存データの全項目（知らないキーも含む）に、既定値を補ったもの。
//
// 方針:
//   - 保存済みの値は尊重し、知らないキーも消さずに引き継ぐ（...saved）。
//     別バージョンのプラグインが書いた値を、読み込み→保存で失わないため。
//   - 後から追加された設定には既定値を補う。
//   - 旧バージョンのキー（maintVisible / maintPos / maintSections）は、新しいキーが
//     無いときだけ読み替える。新しいキーがあればそちらを優先する。
//
// 注意: 返す state.folders は FOLDERS の「コピー」。保存用の写しであり、
// 実行時の正は FOLDERS 側。両者を揃える手続きは setFolder / resetUserSettings に集約している。
function loadSettings(saved) {
  Object.assign(FOLDERS, DEFAULT_FOLDERS, saved.folders ?? {});
  return {
    ...saved,
    folders: { ...FOLDERS },
    orphanAllowedFolder: normalizeAllowedOrphanFolder(saved.orphanAllowedFolder ?? '') ?? '',
    graphPlanarColor: saved.graphPlanarColor ?? CONFIG.graphPlanarColor,
    primitiveAreaColor: saved.primitiveAreaColor ?? CONFIG.primitiveAreaColor,
    graphUndeterminedColor: saved.graphUndeterminedColor ?? CONFIG.graphUndeterminedColor,
    // 旧既定色だけを新しい色分けの既定色へ移行し、利用者のカスタム色は維持する。
    clusterHighlightColor:
      saved.clusterHighlightColor === "#FF3030"
        ? CONFIG.clusterHighlightColor
        : (saved.clusterHighlightColor ?? CONFIG.clusterHighlightColor),
    graphNonPlanarColor:
      saved.graphNonPlanarColor ?? CONFIG.graphNonPlanarColor,
    tagStopWords: normalizeTagStopWords(saved.tagStopWords),
    enableExternalImageEmbeds: saved.enableExternalImageEmbeds === true,
    visible: saved.visible ?? saved.maintVisible ?? true,
    collapsed: saved.maintCollapsed ?? false, // 旧 collapsed は links パネルの状態なので引き継がない
    pos: normalizeWindowPosition(saved.pos ?? saved.maintPos),
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
      saved.maintSections,
      saved.sections,
    ),
  };
}

// ---- 設定の更新 ------------------------------------------------
// 以下の関数は state を書き換えるだけで、保存（saveData）はしない。
// 保存のタイミングは呼び出し側が決める（複数の変更をまとめて1回で保存できるように）。
// 入力値の検証も呼び出し側の責務。ここへ渡る値は検証済みであることを前提にする。

// 管理フォルダ1件の変更。実行時の FOLDERS と、保存用の state.folders を同時に更新する。
// 片方だけ更新すると、再起動後に設定が巻き戻る、または実行中に反映されない不整合になる。
function setFolder(state, key, folder) {
  FOLDERS[key] = folder;
  state.folders = { ...FOLDERS };
}

// 「設定を初期値に戻す」。利用者が変更できる設定を既定値へ戻す。
// 小窓の位置・表示状態・折りたたみなどは、設定ではなく利用状況なので保持する。
// 設定項目を増やしたときは、ここに追加しないとリセットで戻らない点に注意。
function resetUserSettings(state) {
  state.orphanAllowedFolder = '';
  Object.assign(FOLDERS, DEFAULT_FOLDERS);
  state.folders = { ...FOLDERS };
  state.graphPlanarColor = CONFIG.graphPlanarColor;
  state.primitiveAreaColor = CONFIG.primitiveAreaColor;
  state.graphUndeterminedColor = CONFIG.graphUndeterminedColor;
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
  IMAGE_MIME_TYPES,
  CONFIG,
  DEFAULT_FOLDERS,
  DEFAULT_TAG_STOP_WORDS,
  normalizeTagStopWords,
  normalizeAllowedOrphanFolder,
  FOLDERS,
  isManagedPath,
  loadSettings,
  setFolder,
  resetUserSettings,
  getHighlightColor,
};
