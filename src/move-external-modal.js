const { Modal, Setting, Notice } = require("obsidian");
const path = require("path");
const { pathFromSource } = require("./source-url");

class MoveExternalModal extends Modal {
  constructor(app, entries, actions) {
    super(app);
    this.entries = [...new Map(entries.filter(entry => pathFromSource(entry.source)).map(entry => [entry.source, entry])).values()];
    this.actions = actions;
    this.selected = new Set();
    this.folder = "";
    this.busy = false;
  }

  onOpen() { this.renderSelection(); }

  renderSelection(message = "") {
    this.contentEl.empty();
    this.setTitle("外部ファイルを移動");
    this.contentEl.createEl("p", { text: "このノートのリストから移動するファイルを選択してください。ファイル名は保持し、参照先も更新します。" });
    if (message) this.contentEl.createEl("p", { text: message, attr: { role: "status" } });
    const list = this.contentEl.createDiv({ cls: "tk-move-file-list" });
    for (const entry of this.entries) {
      const filename = pathFromSource(entry.source);
      const label = list.createEl("label", { cls: "tk-move-file-option" });
      const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = this.selected.has(entry.source);
      const description = label.createSpan();
      description.createEl("strong", { text: path.basename(filename) });
      description.createEl("small", { text: filename });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.add(entry.source);
        else this.selected.delete(entry.source);
        update();
      });
    }
    const folderSetting = new Setting(this.contentEl).setName("移動先フォルダー").setDesc(this.folder || "未選択");
    folderSetting.addButton(button => button.setButtonText("フォルダーを選択").onClick(async () => {
      try {
        const electron = require("electron");
        const dialog = (electron.remote ?? require("@electron/remote")).dialog;
        const result = await dialog.showOpenDialog({ title: "外部ファイルの移動先", properties: ["openDirectory"] });
        if (!result.canceled && result.filePaths[0]) {
          this.folder = result.filePaths[0];
          folderSetting.setDesc(this.folder);
          update();
        }
      } catch (error) { new Notice(error.message); }
    }));
    let next;
    const update = () => next?.setDisabled(!this.selected.size || !this.folder);
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText("キャンセル").onClick(() => this.close()))
      .addButton(button => { next = button; button.setButtonText("移動内容を確認").setCta().onClick(() => this.renderConfirmation()); });
    update();
  }

  renderConfirmation() {
    const entries = this.entries.filter(entry => this.selected.has(entry.source));
    this.contentEl.empty();
    this.setTitle("移動内容の確認");
    this.contentEl.createEl("p", { text: entries.length + "件を次のフォルダーに移動します。" });
    this.contentEl.createEl("p", { text: this.folder, cls: "tk-move-path" });
    const list = this.contentEl.createEl("ul", { cls: "tk-move-file-list" });
    for (const entry of entries) list.createEl("li", { text: pathFromSource(entry.source) });
    this.contentEl.createEl("p", { text: "同名ファイルがある場合は開始しません。途中で失敗した場合は、その時点で停止して完了件数を表示します。" });
    const status = this.contentEl.createEl("p", { attr: { role: "status" } });
    let back;
    new Setting(this.contentEl)
      .addButton(button => { back = button; button.setButtonText("戻る").onClick(() => this.renderSelection()); })
      .addButton(button => button.setButtonText("移動する").setCta().onClick(async () => {
        if (this.busy) return;
        this.busy = true;
        button.setDisabled(true);
        back.setDisabled(true);
        status.setText("移動中です…");
        try {
          const completed = await this.actions.moveExternalFiles(entries, this.folder);
          this.contentEl.empty();
          this.contentEl.createEl("p", { text: completed.length + "件の移動が完了しました。", attr: { role: "status" } });
          new Setting(this.contentEl).addButton(close => close.setButtonText("閉じる").onClick(() => this.close()));
        } catch (error) {
          const completed = new Set(error.completed ?? []);
          this.entries = this.entries.filter(entry => !completed.has(entry.source));
          for (const source of completed) this.selected.delete(source);
          this.renderSelection(completed.size + "件移動済み。残りの処理を停止しました。" + error.message);
        } finally { this.busy = false; }
      }));
  }

  onClose() { this.contentEl.empty(); }
}
module.exports = MoveExternalModal;
