const { t } = require('./i18n');
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
    this.setTitle(t("files.move"));
    this.contentEl.createEl("p", { text: t("files.selectMove") });
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
    const folderSetting = new Setting(this.contentEl).setName(t("files.destination")).setDesc(this.folder || t("files.notSelected"));
    folderSetting.addButton(button => button.setButtonText(t("files.chooseFolder")).onClick(async () => {
      try {
        const electron = require("electron");
        const dialog = (electron.remote ?? require("@electron/remote")).dialog;
        const result = await dialog.showOpenDialog({ title: t("files.destinationTitle"), properties: ["openDirectory"] });
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
      .addButton(button => button.setButtonText(t("common.cancel")).onClick(() => this.close()))
      .addButton(button => { next = button; button.setButtonText(t("files.review")).setCta().onClick(() => this.renderConfirmation()); });
    update();
  }

  renderConfirmation() {
    const entries = this.entries.filter(entry => this.selected.has(entry.source));
    this.contentEl.empty();
    this.setTitle(t("files.reviewTitle"));
    this.contentEl.createEl("p", { text: t('files.moveCount', { count: entries.length }) });
    this.contentEl.createEl("p", { text: this.folder, cls: "tk-move-path" });
    const list = this.contentEl.createEl("ul", { cls: "tk-move-file-list" });
    for (const entry of entries) list.createEl("li", { text: pathFromSource(entry.source) });
    this.contentEl.createEl("p", { text: t("files.moveCaution") });
    const status = this.contentEl.createEl("p", { attr: { role: "status" } });
    let back;
    new Setting(this.contentEl)
      .addButton(button => { back = button; button.setButtonText(t("files.back")).onClick(() => this.renderSelection()); })
      .addButton(button => button.setButtonText(t("files.moveNow")).setCta().onClick(async () => {
        if (this.busy) return;
        this.busy = true;
        button.setDisabled(true);
        back.setDisabled(true);
        status.setText(t("files.moving"));
        try {
          const completed = await this.actions.moveExternalFiles(entries, this.folder);
          this.contentEl.empty();
          this.contentEl.createEl("p", { text: t('files.moved', { count: completed.length }), attr: { role: "status" } });
          new Setting(this.contentEl).addButton(close => close.setButtonText(t("window.closeAction")).onClick(() => this.close()));
        } catch (error) {
          const completed = new Set(error.completed ?? []);
          this.entries = this.entries.filter(entry => !completed.has(entry.source));
          for (const source of completed) this.selected.delete(source);
          this.renderSelection(t('files.moveStopped', { count: completed.size, error: error.message }));
        } finally { this.busy = false; }
      }));
  }

  onClose() { this.contentEl.empty(); }
}
module.exports = MoveExternalModal;
