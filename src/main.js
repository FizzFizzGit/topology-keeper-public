const WindowHost = require('./windows/window-host');
const { SettingsPersistence } = require('./settings/settings-persistence');
const {
  Plugin,
  Notice,
  TFile,
  debounce,
  getAllTags,
} = require("obsidian");
const TagSuggestionWorkflow = require('./tags/tag-suggestion-workflow');
const { t } = require('./i18n/i18n');
const { pageUrl, captureWebPage } = require('./web-thumbnail/web-page-capture');
const { WebThumbnailModal } = require('./web-thumbnail/web-thumbnail-modal');
const { WebThumbnailWorkflow } = require('./web-thumbnail/web-thumbnail-workflow');
const { styleWebThumbnails } = require('./web-thumbnail/web-thumbnail-data');
const TopologyKeeperSettingTab = require("./settings/settings-tab");
const ImportWorkflow = require("./files/import-workflow");
const BaseWorkflow = require("./bases/base-workflow");
const { copyTextToClipboard } = require("./shared/clipboard");
const { inFolder, isImage, createFilePredicates } = require("./files/file-utils");
const { CSS_CLASS } = require("./shared/ui-constants");
const { collectExternalEntries } = require("./files/external-file-data");
const { filenameFromSource } = require("./files/source-url");
const BaseManager = require("./bases/base-manager");
const ExternalFileActions = require("./files/external-file-actions");
const ExternalImageEmbed = require("./files/external-image-embed");
const { computeOrphans: detectOrphans } = require("./analysis/maintenance-check");
const MaintenanceWorkflow = require("./analysis/maintenance-workflow");
const {
  CONFIG,
  loadSettings,
} = require("./settings/plugin-settings");

// 設定の正本はこのインスタンスのstate。既定値・正規化はplugin-settings.jsに集約する。

// =================================================================
//  プラグイン本体
// =================================================================
module.exports = class AssetLinksPanel extends Plugin {
  // 全ての保存を同じ待機列へ通し、返すPromiseの成否は維持する。
  saveData(data) {
    return this.persistence ? this.persistence.save(data) : super.saveData(data);
  }

  async onload() {
    this.tagSuggestions = new TagSuggestionWorkflow(this);
    // 保存データ（Obsidian が Vault 内 `.obsidian/plugins/<プラグインID>/data.json` に JSON で保存したもの）。
    // 初回起動では null なので {} にする。項目の一覧は plugin-settings.js の loadSettings を参照。
    const s = (await this.loadData()) ?? {};
    this.persistence = new SettingsPersistence(data => super.saveData(data), error => {
      console.error('Topology Keeper settings save failed:', error);
      new Notice(t('notice.settingsSaveFailed'));
    });
    this.uiStyleEl = document.createElement("style");
    this.uiStyleEl.textContent = `
      @keyframes tk-cycle-spin { to { transform: rotate(360deg); } }
      .alp-refresh-btn.is-loading .svg-icon { animation: tk-cycle-spin 1s linear infinite; transform-origin: center; }
    `;
    document.head.appendChild(this.uiStyleEl);
    // 設定を読み込んでから、各機能へ同じstate.foldersの参照を渡す。
    // 以後、このファイル内の `this.saveData(this.state)` は、state 全体を上記の data.json にそのまま保存する
    // （保存される項目の一覧は plugin-settings.js の loadSettings を参照）。ドラッグ後の位置・欄の開閉・
    // 表示の切り替えなどは操作のたびに保存する。画面端への補正で変わった位置だけは、保存せず、
    // 次に保存されるときに一緒に書かれる。
    this.state = loadSettings(s);
    this.files = createFilePredicates(() => this.state.folders);
    this.baseManager = new BaseManager(this, { CONFIG, FOLDERS: this.state.folders });
    this.baseWorkflow = new BaseWorkflow(this);
    this.externalFileActions = new ExternalFileActions(this.app, {
      getSettings: () => this.state,
      CONFIG,
      FOLDERS: this.state.folders,
      TFile,
      isImage,
    });
    this.importWorkflow = new ImportWorkflow(this, { isImage });
    this.webThumbnails = new WebThumbnailWorkflow(this, {
      capture: captureWebPage,
      createModal: (url, cancel) => new WebThumbnailModal(this.app, url, cancel),
      getBrowserWindow: () => {
        try {
          const electron = require('electron');
          const BrowserWindow = (electron.remote ?? require('@electron/remote')).BrowserWindow;
          if (typeof BrowserWindow !== 'function') throw new Error();
          return BrowserWindow;
        } catch { throw new Error('capture-unavailable'); }
      },
      notice: message => new Notice(message), t,
    });
    this.addSettingTab(new TopologyKeeperSettingTab(this.app, this, { CSS_CLASS }));
    this.currentFile = null; // 外部ファイル欄が対象にしているノート（TFile）。対象外のときは null
    // Base の表示名の索引 Map<Base の Vault相対パス, 表示名>。loadBaseLabels が作る（保存しない）。
    this.baseLabels = new Map();
    // 外部画像の埋め込み表示（external-image-embed.js）。画像の Blob URL のキャッシュもこの中にあり、
    // onunload の dispose() で解放する。source URL の変換は source-url.js で共有する。
    this.externalImages = new ExternalImageEmbed(this.app, {
      getSettings: () => this.state,
      inFolder,
      isImage,
      embedClass: CSS_CLASS.imageEmbed,
    });
    // 表示用の分析結果とグラフ状態。実行制御・再チェック表示はMaintenanceWorkflowが管理する。
    this.maint = { token: 0, result: { orphans: [], strayThumbs: [], orphanBases: [], maintenanceReady: false } };
    this.maintenance = new MaintenanceWorkflow(this, {
      isManaged: this.files.isManaged,
      isManagedPath: this.files.isManagedPath,
      getAllTags,
      maxFindings: CONFIG.maxFindings,
    });
    this.windows = new WindowHost(this);

    this.refreshWin = debounce(
      () => {
        this.updateCurrent();
        this.mainView.render();
      },
      150,
      true,
    );
    this.refreshBaseLabels = debounce(
      () => this.baseManager.loadBaseLabels(),
      250,
      true,
    );
    this.scheduleMaint = debounce(
      () => { if (this.layoutReady) void this.maintenance.refreshVisible(); },
      CONFIG.maintenanceDelay,
      true,
    );

    this.registerMarkdownPostProcessor((el, ctx) =>
      this.externalImages.render(el, ctx),
    );
    this.registerMarkdownPostProcessor(element => styleWebThumbnails(element, this.state.webThumbnailFiles));
    this.windows.registerEvents();
    this.registerMaintenanceEvents();
    this.registerCommands();
  }

  registerMaintenanceEvents() {
    // 重い再計算は一定時間まとめてから実行する。
    this.registerEvent(
      this.app.metadataCache.on("resolved", this.scheduleMaint),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", this.scheduleMaint),
    );
    for (const ev of ["create", "delete", "rename"]) {
      this.registerEvent(
        this.app.vault.on(ev, (file) => {
          this.scheduleMaint();
          if (file?.extension === "base") this.refreshBaseLabels();
        }),
      );
    }
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file?.extension === "base") this.refreshBaseLabels();
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true;
      void this.maintenance.restoreDistanceAnalysis();
      this.updateCurrent();
      this.windows.restore();
      this.refreshBaseLabels();
      this.scheduleMaint();
    });
  }

  registerCommands() {
    this.addCommand({
      id: 'insert-web-thumbnail',
      name: t('command.insertWebThumbnail'),
      editorCheckCallback: (checking, editor, view) => {
        if (!this.files.isMainNote(view.file)) return false;
        try { pageUrl(editor.getSelection() || editor.getLine(editor.getCursor().line)); }
        catch { return false; }
        if (!checking) void this.webThumbnails.run(editor, view);
        return true;
      },
    });
    this.addCommand({
      id: "recover-import",
      name: t("command.recoverImport"),
      callback: () => this.importWorkflow.recover(),
    });
    this.addCommand({
      id: "reset-window-positions",
      name: t("command.resetPositions"),
      callback: () => this.resetWindowPositions(),
    });
    this.addCommand({
      id: "add-external-files",
      name: t("command.addExternalFiles"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md" || this.files.isManaged(file)) return false;
        if (!checking) this.importWorkflow.importFiles(file);
        return true;
      },
    });
    this.addCommand({
      id: "toggle-maintenance-window",
      name: t("command.toggleWindow"),
      callback: async () => {
        this.state.visible = !this.state.visible;
        await this.saveData(this.state);
        this.mainView.applyVisibility();
      },
    });
    this.addCommand({
      id: "recheck-maintenance",
      name: t("command.recheck"),
      callback: () => this.maintenance.recheckAll(),
    });
    this.addCommand({
      id: "clear-distance-analysis",
      name: t("command.clearDistanceAnalysis"),
      checkCallback: (checking) => {
        if (!this.maintenance.canClearDistanceAnalysis()) return false;
        if (!checking) {
          void this.maintenance.clearDistanceAnalysis().then(cleared => {
            if (cleared) new Notice(t("area.distanceCacheCleared"));
          });
        }
        return true;
      },
    });
    this.addCommand({
      id: "suggest-tags",
      name: t("command.suggestTags"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md" || this.files.isManaged(file)) return false;
        if (!checking) this.tagSuggestions.suggest(file);
        return true;
      },
    });
  }

  get mainView() { return this.windows.mainView; }
  get detailView() { return this.windows.detailView; }
  get orphanView() { return this.windows.orphanView; }
  get sidebars() { return this.windows.sidebars; }

  resetWindowPositions() { return this.windows.resetWindowPositions(); }
  applyWindowPlacement(kind) { this.windows.applyWindowPlacement(kind); }
  applyWindowAppearance() { this.windows.applyWindowAppearance(); }

  onunload() {
    this.layoutReady = false;
    this.webThumbnails?.dispose();
    this.tagSuggestions?.dispose();
    this.maintenance.cancel(); // 実行中の計算を中断
    this.uiStyleEl?.remove();
    this.windows.dispose();
    this.externalImages.dispose(); // キャッシュした画像の Blob URL を解放する
  }

  // 外部ファイル欄の対象ノート（this.currentFile）を、いま開いているノートに合わせる。
  // workspace.getActiveFile() は、開いているファイルの TFile、ファイルを持たないビューでは null を返す。
  // 通常のMarkdownノート（管理フォルダの外の .md）のときだけそのノートを対象にし、
  // それ以外（管理フォルダ内のノート、画像など、ファイルを持たないビュー）では null に戻す。
  updateCurrent() {
    const f = this.app.workspace.getActiveFile();
    this.currentFile = f && f.extension === "md" && !this.files.isManaged(f) ? f : null;
  }

  // =============================================================
  //  外部ファイル欄のデータ
  // =============================================================
  // 外部ファイル欄に表示するデータを作る。
  //   入力: this.currentFile（updateCurrent が決めた対象ノート）と、そのノートの frontmatter
  //         （metadataCache.getFileCache(file)?.frontmatter。YAML が無ければ undefined）。
  //   出力: 対象ノートが無い／Vault から消えているときは null。それ以外は { file, main, entries }。
  //     file    : 対象ノートの TFile
  //     main    : メインノート（管理フォルダ外の .md）か。
  //     entries : メインノートのときだけ collectExternalEntries の結果（external-file-data.js 参照）、他は空配列。
  //   結果は保存せず、メイン小窓の再描画のたびに作り直す（描画差分の判定にも使われる）。
  computeExternal() {
    const file = this.currentFile;
    if (
      !file ||
      !(this.app.vault.getAbstractFileByPath(file.path) instanceof TFile)
    )
      return null;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const main = this.files.isMainNote(file);
    return { file, main, entries: main ? this.collectEntries(file, fm) : [] };
  }

  // linksの解決処理は外部ファイル用データヘルパーへ委譲する。
  collectEntries(file, fm) {
    return collectExternalEntries({
      app: this.app,
      file,
      frontmatter: fm,
      baseLabels: this.baseLabels,
      metaFolder: this.state.folders.meta,
      linksProperty: CONFIG.properties.links,
    });
  }

  // 孤立ファイルの判定ロジックは maintenance-check.js に委譲する。
  // 戻り値は { orphans, strayThumbs, orphanBases }（いずれも TFile の配列。詳細は maintenance-check.js）。
  computeOrphans() {
    return detectOrphans(this.app, {
      CONFIG,
      FOLDERS: this.state.folders,
      getAllTags,
      inFolder,
      getThumbnailForMeta: (file) =>
        this.externalFileActions.getThumbnailForMeta(file),
      listBases: () => this.baseManager.listBases(),
      webThumbnailFiles: this.state.webThumbnailFiles,
    });
  }

  // 外部ファイル一覧と詳細窓が使う共通UI部品は MainWindowView に委譲する。
  // ファイルへの Obsidian 内部リンク "[[<Vault相対パス>]]" をクリップボードにコピーする。
  async copyInternalLink(file) {
    if (!file) return;
    try {
      await copyTextToClipboard(`[[${file.path}]]`);
      new Notice(t("notice.copyDone"));
    } catch (error) {
      console.error("リンクをコピーできませんでした:", error);
      new Notice(t("notice.copyFailed"));
    }
  }

  // メタノートの表示名。frontmatter.source（"file:///..." 形式のURL）があれば元ファイル名、無ければメタノートの名前。
  metaLabel(file) {
    const source =
      this.app.metadataCache.getFileCache(file)?.frontmatter?.source;
    return source ? filenameFromSource(source) : file.basename;
  }

};
