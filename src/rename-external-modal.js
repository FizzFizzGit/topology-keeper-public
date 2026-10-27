const { Modal, Setting, Notice } = require("obsidian");
class RenameExternalModal extends Modal {
  constructor(app, filename, rename) { super(app); this.filename = filename; this.rename = rename; }
  onOpen() {
    this.setTitle("外部ファイルの名前を変更");
    let value = this.filename;
    let input;
    new Setting(this.contentEl).setName("ファイル名（拡張子を含む）").addText(text => {
      input = text.inputEl;
      text.setValue(value).onChange(next => { value = next; });
    });
    new Setting(this.contentEl).addButton(button => button.setButtonText("キャンセル").onClick(() => this.close()))
      .addButton(button => button.setButtonText("変更").setCta().onClick(async () => {
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
