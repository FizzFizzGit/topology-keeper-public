const { t } = require('./i18n');
const { Modal, Setting, Notice } = require("obsidian");
class RenameExternalModal extends Modal {
  constructor(app, filename, rename) { super(app); this.filename = filename; this.rename = rename; }
  onOpen() {
    this.setTitle(t("files.renameTitle"));
    let value = this.filename;
    let input;
    new Setting(this.contentEl).setName(t("files.filename")).addText(text => {
      input = text.inputEl;
      text.setValue(value).onChange(next => { value = next; });
    });
    new Setting(this.contentEl).addButton(button => button.setButtonText(t("common.cancel")).onClick(() => this.close()))
      .addButton(button => button.setButtonText(t("files.change")).setCta().onClick(async () => {
        button.setDisabled(true);
        input.disabled = true;
        try { await this.rename(value); this.close(); }
        catch (error) { new Notice(error.message); button.setDisabled(false); input.disabled = false; }
      }));
    input.focus();
    const dot = value.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : value.length);
  }
  onClose() { this.contentEl.empty(); }
}
module.exports = RenameExternalModal;
