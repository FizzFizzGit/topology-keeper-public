// メイン窓・詳細窓・設定画面で共有する表示名とUI識別子。
// UIの振る舞いは各Viewに置き、ここには再利用する定数だけを置く。
const UI_TEXT = {
  create: "作成",
  cancel: "キャンセル",
  close: "閉じる",
  detailOpen: "詳細を開く",
  detailClose: "詳細を閉じる",
  orphan: "孤立",
  crossingCandidates: "エリア候補",
  clean: "✨ クリーンです",
};

const CSS_CLASS = {
  modalButtonContainer: "modal-button-container",
  modalError: "topology-keeper-modal-error",
  settingDescription: "setting-item-description",
  clickableIcon: "clickable-icon",
  modCta: "mod-cta",
  modWarning: "mod-warning",
  imageEmbed: "topology-keeper-image-embed",
  alpWin: "alp-win",
  alpSmall: "alp-small",
  alpEmpty: "alp-empty",
  alpRow: "alp-row",
  alpName: "alp-name",
  alpDetailWin: "alp-detail-win",
  alpActionButton: "alp-action-button",
  isHidden: "is-hidden",
  isLink: "is-link",
  isPanning: "is-panning",
};

const ICON = {
  network: "network",
  chart: "chart-no-axes-combined",
  unplug: "unplug",
  branch: "git-branch",
  folder: "folder",
  filePlus: "file-plus",
  base: "database",
  tags: "tags",
  fork: "git-fork",
};

const EVENT = {
  click: "click",
  keydown: "keydown",
  toggle: "toggle",
  pointerdown: "pointerdown",
  pointermove: "pointermove",
  pointerup: "pointerup",
  pointercancel: "pointercancel",
  wheel: "wheel",
};

module.exports = { UI_TEXT, CSS_CLASS, ICON, EVENT };
