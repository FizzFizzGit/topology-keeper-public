const { PluginSettingTab, Setting, Notice } = require("obsidian");
const { t } = require('./i18n');
const { renderWindowSettings } = require('./window-settings');
const {
  DEFAULT_FOLDERS,
  normalizeTagStopWords,
  normalizeAllowedOrphanFolder,
  setFolder,
  resetUserSettings,
  getHighlightColor,
} = require("./plugin-settings");

// 設定画面は入力検証・UI・保存タイミングを担当する。
// 管理フォルダはplugin.state.foldersを読み、setFolder/resetUserSettingsで更新する。
// 実行用・保存用の二重管理はしない。フォルダ名変更は既存ファイルを移動しない。

class TopologyKeeperSettingTab extends PluginSettingTab {
  // options には、設定ファイルに属さない実装識別子（CSS_CLASS）だけを受け取る。
  constructor(app, plugin, options) {
    super(app, plugin);
    this.plugin = plugin;
    this.options = options;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Topology Keeper" });
    renderWindowSettings(containerEl, this.plugin, { Setting, t });
    new Setting(containerEl)
      .setName(t("settings.positions"))
      .setDesc(t("settings.positionsDesc"))
      .addButton(button => button.setButtonText(t("settings.resetPositions")).onClick(async () => {
        await this.plugin.resetWindowPositions();
        new Notice(t("settings.positionsReset"));
      }));

    containerEl.createEl("h3", { text: t("settings.externalFiles") });
    if (this.plugin.state.pendingImport) {
      new Setting(containerEl)
        .setName(t("settings.pendingImport"))
        .setDesc(t('settings.pendingDesc', { path: this.plugin.state.pendingImport.mainNotePath }))
        .addButton(button => button.setButtonText(t("settings.recover")).onClick(async () => {
          await this.plugin.importWorkflow.recover();
          this.display();
        }))
        .addButton(button => button.setButtonText(t("settings.clearRecovery")).onClick(async () => {
          await this.plugin.importWorkflow.discardRecovery();
          this.display();
        }));
    }
    new Setting(containerEl)
      .setName(t("settings.embedImages"))
      .setDesc(t("settings.embedImagesDesc"))
      .addToggle(toggle => toggle.setValue(this.plugin.state.enableExternalImageEmbeds).onChange(async value => {
        this.plugin.state.enableExternalImageEmbeds = value;
        await this.plugin.saveData(this.plugin.state);
      }));
    containerEl.createEl("h3", { text: t("settings.managedFolders") });
    containerEl.createEl("p", {
      text: t("settings.storageDesc"),
    });
    const entries = [
      [
        "meta",
        t("settings.metaFolder"),
        t("settings.metaFolderDesc"),
      ],
      ["thumb", t("settings.thumbnailFolder"), t("settings.thumbnailFolderDesc")],
      ["base", t("settings.baseFolder"), t("settings.baseFolderDesc")],
    ];
    for (const [key, name, desc] of entries) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((text) =>
          text
            .setPlaceholder(DEFAULT_FOLDERS[key])
            .setValue(this.plugin.state.folders[key])
            .onChange(async (value) => {
              // value: テキスト欄の現在の入力文字列。Obsidian はキー入力のたびにこの関数を呼ぶので、
              //        入力の途中の値でも、下の検証を通れば、その時点で保存・反映される。
              // folder: 前後の空白と、前後の "/" を取り除いた Vault 相対パス（例 "管理/メタ"）。
              const folder = value.trim().replace(/^\/+|\/+$/g, "");
              // 入力途中の空欄では保存せず、次の入力を待つ。
              if (!folder) return;
              if (
                folder
                  .split("/")
                  .some((part) => !part || part === "." || part === "..") ||
                folder.includes("\\")
              ) {
                new Notice(t("settings.invalidFolder"));
                return;
              }
              const other = Object.entries(this.plugin.state.folders).find(
                ([otherKey, otherPath]) =>
                  otherKey !== key && otherPath === folder,
              );
              if (other) {
                new Notice(
                  t("settings.duplicateFolder"),
                );
                return;
              }
              // 保存も実行も同じstate.foldersを参照する。
              setFolder(this.plugin.state, key, folder);
              await this.plugin.saveData(this.plugin.state);
            }),
        );
    }

    containerEl.createEl('h3', { text: t("settings.isolatedNotes") });
    new Setting(containerEl)
      .setName(t("settings.excludedFolder"))
      .setDesc(t("settings.excludedFolderDesc"))
      .addText(text => text.setPlaceholder(t("settings.unsortedExample")).setValue(this.plugin.state.orphanAllowedFolder ?? '').onChange(async value => {
        const folder = normalizeAllowedOrphanFolder(value);
        if (folder === null) { new Notice(t("settings.invalidFolder")); return; }
        this.plugin.state.orphanAllowedFolder = folder;
        await this.plugin.saveData(this.plugin.state);
        this.plugin.scheduleMaint();
      }));

    containerEl.createEl("h3", { text: t("settings.graphDisplay") });
    const graphColors = [
      [
        "clusterHighlightColor",
        t("settings.densePlanarColor"),
        t("settings.densePlanarColorDesc"),
      ],
      ["graphPlanarColor", t("settings.planarColor"), t("settings.planarColorDesc")],
      [
        "graphNonPlanarColor",
        t("settings.nonplanarColor"),
        t("settings.nonplanarColorDesc"),
      ],
      ['graphUndeterminedColor', t("settings.undeterminedColor"), t("settings.undeterminedColorDesc")],
      [null, t('settings.undeterminedCombined'), t('settings.undeterminedCombinedDesc')],
      ['primitiveAreaColor', t("settings.primitiveColor"), t("settings.primitiveColorDesc")],
    ];
    for (const [key, name, description] of graphColors) {
      const setting = new Setting(containerEl)
        .setName(name)
        .setDesc(description);
      if (key) setting.addColorPicker((picker) =>
        picker
          .setValue(
            key === "clusterHighlightColor"
              ? getHighlightColor(this.plugin.state)
              : this.plugin.state[key],
          )
          .onChange(async (value) => {
            this.plugin.state[key] = value;
            await this.plugin.saveData(this.plugin.state);
            this.plugin.refreshWin();
          }),
      );
    }

    containerEl.createEl("h3", { text: t("settings.tagSuggestions") });
    new Setting(containerEl)
      .setName(t("settings.stopWords"))
      .setDesc(t("settings.stopWordsDesc"))
      .addTextArea((text) =>
        text
          .setPlaceholder(t("settings.stopWordsExample"))
          .setValue((this.plugin.state.tagStopWords ?? []).join("\n"))
          .onChange(async (value) => {
            this.plugin.state.tagStopWords = normalizeTagStopWords(
              value.split(/\r?\n/),
            );
            await this.plugin.saveData(this.plugin.state);
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.resetAll"))
      .setDesc(
        t("settings.resetAllDesc"),
      )
      .addButton((button) =>
        button
          .setButtonText(t("common.reset"))
          .setWarning()
          .onClick(async () => {
            // リセット対象の定義（何を戻し、何を保持するか）は plugin-settings.js 側にある。
            resetUserSettings(this.plugin.state);
            this.plugin.applyWindowPlacement?.();
            this.plugin.applyWindowAppearance();
            await this.plugin.saveData(this.plugin.state);
            this.display();
            new Notice(t("settings.defaultsRestored"));
          }),
      );
  }
}


module.exports = TopologyKeeperSettingTab;
