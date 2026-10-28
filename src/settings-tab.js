const { PluginSettingTab, Setting, Notice } = require("obsidian");
const { t } = require('./i18n');
const {
  DEFAULT_FOLDERS,
  normalizeTagStopWords,
  normalizeAllowedOrphanFolder,
  FOLDERS,
  setFolder,
  resetUserSettings,
  getHighlightColor,
} = require("./plugin-settings");

// 設定画面は「入力の検証」と「UIの組み立て」だけを担当する。
// 既定値・フォルダ構成の保持・state との同期規則は plugin-settings.js 側にあり、
// ここでは値を直接書き換えず、そこの関数を経由する（同期漏れを防ぐため）。
// 保存（saveData）のタイミングは、ここ（利用者の操作の直後）で決める。
//
// 【データの流れ】
//   読み込み: plugin.state（plugin-settings.js の loadSettings が作った、実行時の設定）と、
//             FOLDERS（実行時に有効な管理フォルダ名）を、画面の初期値として表示する。
//   書き込み: 利用者の入力を検証して plugin.state に反映し、plugin.saveData(plugin.state) で
//             `.obsidian/plugins/<プラグインID>/data.json` に保存する（Obsidian の Plugin.saveData）。
//             フォルダ名の変更は FOLDERS にも即座に反映され、以後の取り込み・孤立判定・Base作成が
//             新しいフォルダ名を使う。既存ファイルは移動されない。

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
    new Setting(containerEl)
      .setName(t("settings.positions"))
      .setDesc(t("settings.positionsDesc"))
      .addButton(button => button.setButtonText(t("settings.resetPositions")).onClick(async () => {
        await this.plugin.resetWindowPositions();
        new Notice(t("settings.positionsReset"));
      }));
    containerEl.createEl("p", {
      text: t("settings.storageDesc"),
    });

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
            .setValue(FOLDERS[key])
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
              const other = Object.entries(FOLDERS).find(
                ([otherKey, otherPath]) =>
                  otherKey !== key && otherPath === folder,
              );
              if (other) {
                new Notice(
                  t("settings.duplicateFolder"),
                );
                return;
              }
              // FOLDERS（実行時）と state.folders（保存用）は必ず同時に更新する。
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
      ['graphUndeterminedColor', t("settings.undeterminedColor"), t("settings.undeterminedColorDesc")],
      ['primitiveAreaColor', t("settings.primitiveColor"), t("settings.primitiveColorDesc")],
      ["graphPlanarColor", t("settings.planarColor"), t("settings.planarColorDesc")],
      [
        "clusterHighlightColor",
        t("settings.hotspotColor"),
        t("settings.hotspotColorDesc"),
      ],
      [
        "graphNonPlanarColor",
        t("settings.nonplanarColor"),
        t("settings.nonplanarColorDesc"),
      ],
    ];
    for (const [key, name, description] of graphColors) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(description)
        .addColorPicker((picker) =>
          picker
            .setValue(
              key === "clusterHighlightColor"
                ? getHighlightColor(this.plugin.state)
                : this.plugin.state[key],
            )
            .onChange(async (value) => {
              this.plugin.state[key] = value;
              await this.plugin.saveData(this.plugin.state);
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
            await this.plugin.saveData(this.plugin.state);
            this.display();
            new Notice(t("settings.defaultsRestored"));
          }),
      );
  }
}


module.exports = TopologyKeeperSettingTab;
