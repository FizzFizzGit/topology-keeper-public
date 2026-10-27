const {
  Plugin,
  Notice,
  TFile,
  debounce,
  getAllTags,
} = require("obsidian");
const { computeTagSuggestions, TagSuggestModal } = require("./tag-suggest");
const TopologyKeeperSettingTab = require("./settings-tab");
const { renderClusterGraph } = require("./graph-view");
const MainWindowView = require("./main-window");
const ImportWorkflow = require("./import-workflow");
const BaseWorkflow = require("./base-workflow");
const { copyTextToClipboard } = require("./clipboard");
const { inFolder, isManaged, isImage, isMainNote } = require("./file-utils");
const { UI_TEXT, CSS_CLASS, ICON, EVENT } = require("./ui-constants");
const openClusterInStandardGraph = require("./standard-graph");
const { renderExternalFiles } = require("./external-files-view");
const { collectExternalEntries } = require("./external-file-data");
const { filenameFromSource } = require("./source-url");
const BaseManager = require("./base-manager");
const ExternalFileActions = require("./external-file-actions");
const ExternalImageEmbed = require("./external-image-embed");
const { computeOrphans: detectOrphans } = require("./maintenance-check");
const MaintenanceWorkflow = require("./maintenance-workflow");
const DetailWindowView = require("./detail-window");
const {
  trashOne: trashOneAction,
  trashOrphans: trashOrphansAction,
  trashOrphanBase: trashOrphanBaseAction,
  trashOrphanBases: trashOrphanBasesAction,
} = require("./maintenance-actions");
const {
  CONFIG,
  FOLDERS,
  isManagedPath,
  loadSettings,
} = require("./plugin-settings");

// 設定値（CONFIG）と管理フォルダ構成（FOLDERS）は plugin-settings.js に集約している。
const ABORTED = Symbol("aborted");

// =================================================================
//  プラグイン本体
// =================================================================
module.exports = class AssetLinksPanel extends Plugin {
  async onload() {
    // 保存データ（Obsidian が Vault 内 `.obsidian/plugins/<プラグインID>/data.json` に JSON で保存したもの）。
    // 初回起動では null なので {} にする。項目の一覧は plugin-settings.js の loadSettings を参照。
    const s = (await this.loadData()) ?? {};
    this.uiStyleEl = document.createElement("style");
    this.uiStyleEl.textContent = `
      @keyframes tk-cycle-spin { to { transform: rotate(360deg); } }
      .alp-refresh-btn.is-loading .svg-icon { animation: tk-cycle-spin 1s linear infinite; transform-origin: center; }
    `;
    document.head.appendChild(this.uiStyleEl);
    // 保存データの読み込みと旧バージョン互換、FOLDERS への反映は plugin-settings.js に集約。
    // FOLDERS の反映が済んでから BaseManager に渡す（参照共有なので順序は本質ではないが、
    // 「設定を読み込んでから各機能を組み立てる」流れを保つ）。
    // 以後、このファイル内の `this.saveData(this.state)` は、state 全体を上記の data.json にそのまま保存する
    // （保存される項目の一覧は plugin-settings.js の loadSettings を参照）。ドラッグ後の位置・欄の開閉・
    // 表示の切り替えなどは操作のたびに保存する。画面端への補正で変わった位置だけは、保存せず、
    // 次に保存されるときに一緒に書かれる。
    this.state = loadSettings(s);
    this.baseManager = new BaseManager(this, { CONFIG, FOLDERS });
    this.baseWorkflow = new BaseWorkflow(this);
    this.externalFileActions = new ExternalFileActions(this.app, {
      getSettings: () => this.state,
      CONFIG,
      FOLDERS,
      TFile,
      isImage,
    });
    this.importWorkflow = new ImportWorkflow(this, { isImage });
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
    this.maint = { token: 0, result: null };
    this.maintenance = new MaintenanceWorkflow(this, {
      isManaged,
      isManagedPath,
      getAllTags,
      maxFindings: CONFIG.maxFindings,
    });
    this.mainView = new MainWindowView({
      state: this.state,
      CSS_CLASS,
      EVENT,
      ICON,
      UI_TEXT,
      getPointerHeldAt: () => this.pointerHeldAt,
      getResult: () => this.maint.result,
      computeExternal: () => this.computeExternal(),
      saveState: () => this.saveData(this.state),
      isMaintSpinning: () => this.maintenance.spinning,
      disposeGraphListeners: () => this.disposeGraphListeners(),
      removeInfoPopovers: (owner) => this.removeInfoPopovers(owner),
      hideInfoPopovers: () =>
        document
          .querySelectorAll(".alp-info-popover")
          .forEach((tip) => tip.setAttr("hidden", "hidden")),
      refresh: () => this.refreshWin(),
      runMaint: (...args) => this.maintenance.run(...args),
      scheduleMaint: () => this.scheduleMaint(),
      getActiveFile: () => this.app.workspace.getActiveFile(),
      isMainNote: (file) => file instanceof TFile && isMainNote(file),
      importFiles: (file) => this.importWorkflow.importFiles(file),
      suggestTags: (file) => this.suggestTags(file),
      createBaseStandalone: () => this.baseWorkflow.createStandalone(),
      renderExternal: (manager, ext) =>
        renderExternalFiles(this, manager, ext, {
          CSS_CLASS,
          EVENT,
          section: this.mainView.section.bind(this.mainView),
          iconButton: this.mainView.iconButton.bind(this.mainView),
        }),
      openDetail: (kind) => (kind === "orphan" ? this.orphanView : this.detailView).open(),
      closeDetail: (kind) => (kind === "orphan" ? this.orphanView : this.detailView).close(),
      isDetailVisible: (kind) => kind === "orphan" ? this.orphanView.visible : kind === "planar" ? this.detailView.visible : this.detailView.visible || this.orphanView.visible,
      renderDetail: () => { this.detailView.render(); this.orphanView.render(); },
      getDetailWindow: () => this.detailView.el,
      setDetailPosition: (position) => {
        this.state.detailPos = position;
      },
      openLink: (id) => this.app.workspace.openLinkText(id, "", "tab"),
    });
    this.detailView = new DetailWindowView({
      setWindowVisible: (visible) => { this.state.areaWindowVisible = visible; },
      getDetailPosition: () => this.state.detailPos,
      saveState: () => this.saveData(this.state),
      getMainWindow: () => this.mainView.el,
      updateDetailButton: () => this.mainView.updateDetailButton(),
      getPointerHeldAt: () => this.pointerHeldAt,
      getResult: () => this.maint.result,
      getSelectedCluster: () => this.maint.selectedCluster,
      getAreaColors: () => ({
        planar: this.state.graphPlanarColor ?? CONFIG.graphPlanarColor,
        hotspot: this.state.clusterHighlightColor ?? CONFIG.clusterHighlightColor,
        nonplanar: this.state.graphNonPlanarColor ?? CONFIG.graphNonPlanarColor,
      }),
      setSelectedCluster: (selection) => {
        this.maint.selectedCluster = selection;
      },
      setDetailPosition: (position) => {
        this.state.detailPos = position;
      },
      getBaseLabel: (file) => this.baseLabels.get(file.path) ?? file.basename,
      refresh: () => this.refreshWin(),
      disposeGraphListeners: () => this.disposeGraphListeners(),
      removeInfoPopovers: (owner) => this.removeInfoPopovers(owner),
      iconButton: this.mainView.iconButton.bind(this.mainView),
      runMaint: (...args) => this.maintenance.run(...args),
      enableDrag: this.mainView.enableDrag.bind(this.mainView),
      fitWindowToContent: this.mainView.fitWindowToContent.bind(this.mainView),
      section: this.mainView.section.bind(this.mainView),
      metaLabel: (file) => this.metaLabel(file),
      openFile: (file) => this.app.workspace.getLeaf("tab").openFile(file),
      trashOrphans: () => trashOrphansAction(this),
      trashOne: (file) => trashOneAction(this, file),
      trashOrphanBases: () => trashOrphanBasesAction(this),
      trashOrphanBase: (file) => trashOrphanBaseAction(this, file),
      nodeChip: this.mainView.nodeChip.bind(this.mainView),
      renderClusterGraph: (...args) => renderClusterGraph(this, ...args),
      highlightCluster: () => openClusterInStandardGraph(this),
      CSS_CLASS,
      UI_TEXT,
      EVENT,
      ICON,
      maxFindings: CONFIG.maxFindings,
    });

    this.orphanView = new DetailWindowView({
      ...this.detailView.api,
      setWindowVisible: (visible) => { this.state.orphanWindowVisible = visible; },
      getDetailPosition: () => this.state.orphanPos,
      setDetailPosition: (position) => { this.state.orphanPos = position; },
    }, "orphan");

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
      () => this.maintenance.run(),
      CONFIG.maintenanceDelay,
      true,
    );

    this.registerMarkdownPostProcessor((el, ctx) =>
      this.externalImages.render(el, ctx),
    );
    this.registerViewEvents();
    this.registerPointerEvents();
    this.registerMaintenanceEvents();
    this.registerCommands();
  }

  registerViewEvents() {
    // 小窓の再描画（軽い）。refreshWin は現在のノートと保持済みの結果から描き直す。
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", this.refreshWin),
    );
    this.registerEvent(this.app.workspace.on("file-open", this.refreshWin));
    this.registerEvent(this.app.metadataCache.on("changed", this.refreshWin));
  }

  registerPointerEvents() {
    // 説明ポップオーバーの外側を押したら閉じる。
    this.registerDomEvent(document, "pointerdown", (event) => {
      if (event.target.closest?.(".alp-info-popover, .alp-info-button")) return;
      document
        .querySelectorAll(".alp-info-popover:not([hidden])")
        .forEach((tip) => tip.setAttr("hidden", "hidden"));
    });

    // 小窓を押している間は再描画を保留する。
    this.pointerHeldAt = 0;
    const hold = (event) => {
      if (event.target.closest?.(".alp-win, .alp-detail-win"))
        this.pointerHeldAt = Date.now();
    };
    const release = () => {
      if (!this.pointerHeldAt) return;
      this.pointerHeldAt = 0;
      // 描画差分の比較で保留中のデータ変更を検出する。
      this.refreshWin();
    };
    this.registerDomEvent(document, "pointerdown", hold, true);
    this.registerDomEvent(document, "pointerup", release, true);
    this.registerDomEvent(document, "pointercancel", release, true);
    this.registerDomEvent(window, "blur", release);

    // Obsidian本体のウィンドウ縮小時に、小窓を表示範囲内へ補正する。
    this.registerDomEvent(
      window,
      "resize",
      debounce(() => {
        this.mainView.constrainToViewport();
        this.detailView.constrainToViewport();
        this.orphanView.constrainToViewport();
      }, 50),
    );
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
      this.updateCurrent();
      this.mainView.build();
      if (this.state.areaWindowVisible) this.detailView.open();
      if (this.state.orphanWindowVisible) this.orphanView.open();
      this.refreshBaseLabels();
      this.scheduleMaint();
    });
  }

  registerCommands() {
    this.addCommand({
      id: "recover-import",
      name: "未完了の取り込みを復旧",
      callback: () => this.importWorkflow.recover(),
    });
    this.addCommand({
      id: "reset-window-positions",
      name: "小窓・詳細窓の位置をリセット",
      callback: () => this.resetWindowPositions(),
    });
    this.addCommand({
      id: "add-external-files",
      name: "外部ファイルを追加（メタノート作成）",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md" || isManaged(file)) return false;
        if (!checking) this.importWorkflow.importFiles(file);
        return true;
      },
    });
    this.addCommand({
      id: "toggle-maintenance-window",
      name: "小窓の表示/非表示",
      callback: async () => {
        this.state.visible = !this.state.visible;
        await this.saveData(this.state);
        this.mainView.applyVisibility();
      },
    });
    this.addCommand({
      id: "recheck-maintenance",
      name: "メンテナンスチェックを再実行",
      callback: () => this.maintenance.run(true),
    });
    this.addCommand({
      id: "suggest-tags",
      name: "タグを提案（既存タグから）",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md" || isManaged(file)) return false;
        if (!checking) this.suggestTags(file);
        return true;
      },
    });
  }

  async resetWindowPositions() {
    this.mainView.resetPosition();
    this.detailView.resetPosition();
    this.orphanView.resetPosition();
    await this.saveData(this.state);
  }

  onunload() {
    this.maintenance.cancel(); // 実行中の計算を中断
    this.uiStyleEl?.remove();
    this.disposeGraphListeners();
    this.removeInfoPopovers();
    this.mainView.dispose();
    this.detailView.dispose();
    this.orphanView.dispose();
    this.externalImages.dispose(); // キャッシュした画像の Blob URL を解放する
  }

  // 外部ファイル欄の対象ノート（this.currentFile）を、いま開いているノートに合わせる。
  // workspace.getActiveFile() は、開いているファイルの TFile、ファイルを持たないビューでは null を返す。
  // 通常のMarkdownノート（管理フォルダの外の .md）のときだけそのノートを対象にし、
  // それ以外（管理フォルダ内のノート、画像など、ファイルを持たないビュー）では null に戻す。
  updateCurrent() {
    const f = this.app.workspace.getActiveFile();
    this.currentFile = f && f.extension === "md" && !isManaged(f) ? f : null;
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
    const main = isMainNote(file);
    return { file, main, entries: main ? this.collectEntries(file, fm) : [] };
  }

  // linksの解決処理は外部ファイル用データヘルパーへ委譲する。
  collectEntries(file, fm) {
    return collectExternalEntries({
      app: this.app,
      file,
      frontmatter: fm,
      baseLabels: this.baseLabels,
      metaFolder: FOLDERS.meta,
      linksProperty: CONFIG.properties.links,
    });
  }

  // 孤立ファイルの判定ロジックは maintenance-check.js に委譲する。
  // 戻り値は { orphans, strayThumbs, orphanBases }（いずれも TFile の配列。詳細は maintenance-check.js）。
  computeOrphans() {
    return detectOrphans(this.app, {
      CONFIG,
      FOLDERS,
      getAllTags,
      inFolder,
      getThumbnailForMeta: (file) =>
        this.externalFileActions.getThumbnailForMeta(file),
      listBases: () => this.baseManager.listBases(),
    });
  }

  disposeGraphListeners() {
    try {
      this.maint.graphCleanup?.();
    } catch (_) {}
    this.maint.graphCleanup = null;
  }

  removeInfoPopovers(owner) {
    const selector = owner
      ? `.alp-info-popover[data-owner="${owner}"]`
      : ".alp-info-popover";
    document.querySelectorAll(selector).forEach((tip) => tip.remove());
  }

  // 外部ファイル一覧と詳細窓が使う共通UI部品は MainWindowView に委譲する。
  // ファイルへの Obsidian 内部リンク "[[<Vault相対パス>]]" をクリップボードにコピーする。
  async copyInternalLink(file) {
    if (!file) return;
    try {
      await copyTextToClipboard(`[[${file.path}]]`);
      new Notice("Obsidianリンクをコピーしました");
    } catch (error) {
      console.error("リンクをコピーできませんでした:", error);
      new Notice("リンクをコピーできませんでした");
    }
  }

  // メタノートの表示名。frontmatter.source（"file:///..." 形式のURL）があれば元ファイル名、無ければメタノートの名前。
  metaLabel(file) {
    const source =
      this.app.metadataCache.getFileCache(file)?.frontmatter?.source;
    return source ? filenameFromSource(source) : file.basename;
  }

  // ノートへのタグ提案を表示し、選ばれたタグをそのノートの frontmatter.tags に追加する。
  //   入力 file: タグを付けたい通常ノートの TFile。提案は computeTagSuggestions（tag-suggest.js）が作る。
  //   モーダルから返る picked: 選ばれたタグ名の配列（"#" なし。空配列なら何もしない）。
  //   出力: file の frontmatter.tags を、既存のタグ＋picked（重複なし）の配列に書き換える。
  //         既存の tags が文字列（"a, b" や "a b" のようなカンマ・空白区切り）でも、配列に直してから足す。
  //         "#" は付けない（frontmatter の tags には、通常 "#" なしのタグ名を書く）。本文は変更しない。
  async suggestTags(file) {
      const items = await computeTagSuggestions(
        this.app,
        file,
        isManaged,
        this.state.tagStopWords,
      );
      if (!items.length) { new Notice("提案できるタグがありませんでした。"); return; }
      new TagSuggestModal(this.app, file, items, async (picked) => {
          if (!picked.length) return;
          await this.app.fileManager.processFrontMatter(file, (fm) => {
              const cur = Array.isArray(fm.tags) ? fm.tags
                  : (fm.tags ? String(fm.tags).split(/[,\s]+/).filter(Boolean) : []);
              fm.tags = [...new Set([...cur, ...picked])];
          });
          new Notice(`${picked.length}件のタグを追加しました。`);
      }).open();
  }

};
