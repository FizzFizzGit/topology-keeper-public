const { PluginSettingTab, Setting, Notice } = require("obsidian");
const {
  DEFAULT_FOLDERS,
  normalizeTagStopWords,
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
      .setName("小窓・詳細窓の位置")
      .setDesc("移動した位置を記憶します。リセットすると小窓は右上、詳細窓は小窓の左側へ戻ります。")
      .addButton(button => button.setButtonText("位置をリセット").onClick(async () => {
        await this.plugin.resetWindowPositions();
        new Notice("小窓・詳細窓の位置をリセットしました。");
      }));
    containerEl.createEl("p", {
      text: "プラグインが作成する管理用ファイルの保存先を設定します。変更しても既存ファイルは自動で移動されず、変更前の保存先に残るファイルは管理対象外になります。必要な場合は手動で移動してください。",
    });

    containerEl.createEl("h3", { text: "外部ファイル" });
    if (this.plugin.state.pendingImport) {
      new Setting(containerEl)
        .setName("未完了の取り込み")
        .setDesc(`元ノート: ${this.plugin.state.pendingImport.mainNotePath}。作成済みファイルを保持し、削除操作を停止しています。`)
        .addButton(button => button.setButtonText("復旧").onClick(async () => {
          await this.plugin.importWorkflow.recover();
          this.display();
        }))
        .addButton(button => button.setButtonText("記録だけ解除").onClick(async () => {
          await this.plugin.importWorkflow.discardRecovery();
          this.display();
        }));
    }
    new Setting(containerEl)
      .setName("外部画像を埋め込み表示")
      .setDesc("既定はオフです。有効にするとメタノートのsourceが指すローカル画像を読み込みます。信頼できるVaultで使用し、変更後は対象ノートを開き直してください。")
      .addToggle(toggle => toggle.setValue(this.plugin.state.enableExternalImageEmbeds).onChange(async value => {
        this.plugin.state.enableExternalImageEmbeds = value;
        await this.plugin.saveData(this.plugin.state);
      }));
    containerEl.createEl("h3", { text: "管理フォルダ" });
    const entries = [
      [
        "meta",
        "メタノートの保存先",
        "外部ファイルの情報を保持するMarkdownノート",
      ],
      ["thumb", "サムネイルの保存先", "外部画像から生成したサムネイル"],
      ["base", "Baseの保存先", "コレクション表示用のBaseファイル"],
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
                new Notice("Vault内の相対フォルダパスを入力してください。");
                return;
              }
              const other = Object.entries(FOLDERS).find(
                ([otherKey, otherPath]) =>
                  otherKey !== key && otherPath === folder,
              );
              if (other) {
                new Notice(
                  "管理フォルダにはそれぞれ異なるパスを指定してください。",
                );
                return;
              }
              // FOLDERS（実行時）と state.folders（保存用）は必ず同時に更新する。
              setFolder(this.plugin.state, key, folder);
              await this.plugin.saveData(this.plugin.state);
            }),
        );
    }

    containerEl.createEl("h3", { text: "平面性とクラトフスキーの定理" });
    containerEl.createEl("p", {
      text: "平面性は、辺を交差させずにグラフを描けるかという性質です。次数1以下の頂点を除き、次数2の頂点を縮約した後、内部リンクが集中するエリアへ分割して判定します。境界をまたぐリンクは各エリアの判定に含めないため、グラフ全体の平面性やノートの品質を保証するものではありません。",
    });
    containerEl.createEl("p", {
      text: "結果は「非平面」「平面」「ホットスポット」の3種類で表示します。平面判定はK₅の細分に必要な次数4以上の頂点5つ、K₃,₃の細分に必要な次数3以上の頂点6つのどちらも存在しない場合に行います。平面性を判定できないエリアは各ノードと1近傍の密度を計算し、隣接ノード間の密度差がその領域の平均を超える辺を境界候補として分けます。3ノード以上で領域密度25%以上のエリアをホットスポットとして表示します。境界候補は試験的な目安で、異常や分類の誤りを意味しません。クリックすると周辺ノードと境界候補辺を含むグラフを表示します。",
      cls: this.options.CSS_CLASS.settingDescription,
    });

    containerEl.createEl("h3", { text: "グラフ表示" });
    const graphColors = [
      ["graphPlanarColor", "平面ノードの色", "平面と判定したノートに使います。"],
      [
        "clusterHighlightColor",
        "ホットスポットの色",
        "ホットスポットに分類したノートに使います。",
      ],
      [
        "graphNonPlanarColor",
        "非平面ノードの色",
        "非平面と判定したノートに使います。",
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

    containerEl.createEl("h3", { text: "タグ提案" });
    new Setting(containerEl)
      .setName("ストップワード")
      .setDesc("新規タグ候補から除外する語を1行に1つ入力します。空欄にすると除外語はありません。")
      .addTextArea((text) =>
        text
          .setPlaceholder("例：\nメモ\nノート\nまとめ")
          .setValue((this.plugin.state.tagStopWords ?? []).join("\n"))
          .onChange(async (value) => {
            this.plugin.state.tagStopWords = normalizeTagStopWords(
              value.split(/\r?\n/),
            );
            await this.plugin.saveData(this.plugin.state);
          }),
      );

    new Setting(containerEl)
      .setName("設定を初期値に戻す")
      .setDesc(
        "管理フォルダ、グラフ分類色、タグ提案のストップワード、外部画像の表示を初期値に戻します。既存ファイルは移動・削除されません。",
      )
      .addButton((button) =>
        button
          .setButtonText("リセット")
          .setWarning()
          .onClick(async () => {
            // リセット対象の定義（何を戻し、何を保持するか）は plugin-settings.js 側にある。
            resetUserSettings(this.plugin.state);
            await this.plugin.saveData(this.plugin.state);
            this.display();
            new Notice("Topology Keeperの設定を初期値に戻しました。");
          }),
      );
  }
}


module.exports = TopologyKeeperSettingTab;
